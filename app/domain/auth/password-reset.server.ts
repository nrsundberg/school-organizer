import { getPrisma } from "~/db.server";
import { hashPassword } from "~/domain/auth/better-auth.server";

/**
 * Password-reset token store.
 *
 * Security posture:
 *   - Raw tokens are generated from 32 bytes of crypto.getRandomValues and
 *     hex-encoded (64 chars). They're only ever returned to the caller who
 *     triggered the reset (so the email can carry the link); the DB only
 *     stores `sha256(token)`.
 *   - Tokens expire after TOKEN_TTL_MINUTES (1 hour).
 *   - Tokens are single-use: `usedAt` is stamped on consumption.
 *   - Consuming a token invalidates every session for the user, forcing
 *     re-login on all devices.
 */

export const TOKEN_TTL_MINUTES = 60;

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 bytes of CSPRNG -> 64 hex chars. */
export function generateResetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/**
 * Create a new reset token for the given user. Returns the RAW token —
 * the caller is responsible for putting it in the email and nowhere else.
 * The DB only gets sha256(token).
 */
export async function createPasswordResetToken(
  context: any,
  params: {
    userId: string;
    requestIp?: string | null;
    requestUserAgent?: string | null;
  },
): Promise<{ rawToken: string; expiresAt: Date }> {
  // PrismaClient is cast to `any` here because the generated client types
  // live in a `@ts-nocheck` barrel and don't surface the new
  // `passwordResetToken` delegate until `prisma generate` runs as part of
  // the build. Runtime behavior is fine — Prisma creates model delegates
  // dynamically from the schema loaded by the adapter.
  const db = getPrisma(context) as any;
  const rawToken = generateResetToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db.passwordResetToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      requestIp: params.requestIp ?? null,
      requestUserAgent: params.requestUserAgent ?? null,
    },
  });

  return { rawToken, expiresAt };
}

export type ResetTokenLookup =
  | { ok: true; tokenId: string; userId: string }
  | {
      ok: false;
      reason: "not-found" | "used" | "expired";
    };

/**
 * Look up a reset token by its raw value. Does NOT mark it used — call
 * `consumePasswordResetToken` for that. Use this from the GET handler to
 * decide whether to render the form or an error state.
 */
export async function lookupPasswordResetToken(
  context: any,
  rawToken: string,
): Promise<ResetTokenLookup> {
  const db = getPrisma(context) as any;
  if (!rawToken) return { ok: false, reason: "not-found" };
  const tokenHash = await sha256Hex(rawToken);
  const row = await db.passwordResetToken.findFirst({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "not-found" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  return { ok: true, tokenId: row.id, userId: row.userId };
}

/**
 * Consume the token: validate it, rewrite the user's password hash, stamp
 * the row as used, and revoke all of the user's active sessions so the
 * attacker (if any) is kicked off every device.
 *
 * Returns `{ ok: true, userId }` on success, or `{ ok: false, reason }`
 * mirroring `lookupPasswordResetToken`.
 */
export async function consumePasswordResetToken(
  context: any,
  params: { rawToken: string; newPassword: string },
): Promise<
  | { ok: true; userId: string }
  | { ok: false; reason: "not-found" | "used" | "expired" | "org-disabled" }
> {
  const db = getPrisma(context) as any;
  const lookup = await lookupPasswordResetToken(context, params.rawToken);
  if (!lookup.ok) return lookup;

  // Re-check the per-tenant toggle at consume time. Someone could have a
  // still-valid token from before the admin disabled reset — block it.
  const user = await db.user.findUnique({
    where: { id: lookup.userId },
    select: { id: true, orgId: true, org: { select: { passwordResetEnabled: true } } },
  });
  if (!user) return { ok: false, reason: "not-found" };
  if (user.org && user.org.passwordResetEnabled === false) {
    return { ok: false, reason: "org-disabled" };
  }

  const hashed = await hashPassword(params.newPassword);
  const account = await db.account.findFirst({
    where: { userId: lookup.userId, providerId: "credential" },
  });
  if (!account) {
    // No credential account to update — treat as not-found so we don't
    // leak that the user exists but uses SSO-only.
    return { ok: false, reason: "not-found" };
  }

  const now = new Date();
  await db.account.update({ where: { id: account.id }, data: { password: hashed } });
  await db.passwordResetToken.update({
    where: { id: lookup.tokenId },
    data: { usedAt: now },
  });
  // Revoke every session for this user — force re-login on all devices.
  await db.session.deleteMany({ where: { userId: lookup.userId } });
  // Clear mustChangePassword if it was set (e.g. by an admin who minted a
  // temp password and then sent the user through self-serve reset).
  await db.user.update({
    where: { id: lookup.userId },
    data: { mustChangePassword: false },
  });

  return { ok: true, userId: lookup.userId };
}

/**
 * Daily cron cleanup: delete fully-expired tokens older than 7 days.
 * We keep recent expired/used tokens for a week for forensic value
 * (e.g. investigating a suspicious reset attempt).
 */
export async function pruneExpiredPasswordResetTokens(
  context: any,
  now: Date = new Date(),
): Promise<number> {
  const db = getPrisma(context) as any;
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
