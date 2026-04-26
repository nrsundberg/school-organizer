import { getPrisma } from "~/db.server";
import { generateResetToken, sha256Hex } from "./password-reset.server";
import { marketingOriginFromRequest } from "~/domain/utils/host.server";

/**
 * Invite-token store for the "staff creates a user" flow.
 *
 * Security posture mirrors PasswordResetToken: 32 bytes of CSPRNG hex →
 * the raw token only ever lives in the outbound email; the DB stores
 * sha256(token). Tokens are single-use and have a TTL (default 7 days).
 *
 * The flow:
 *   1. Staff calls `inviteUser(...)` (in admin-users/invite-user.server)
 *      which creates the user shell and then `createInvite()` here.
 *   2. We email the link `${origin}/accept-invite?token=...`.
 *   3. The user opens the page; the loader calls `lookupInviteToken()` to
 *      decide whether to render the password form or an error state.
 *   4. The action calls `consumeInviteToken()` which validates, marks the
 *      row used, and writes the new password — the route then issues a
 *      session cookie (better-auth signInEmail) and redirects.
 */

export const INVITE_TTL_DAYS = 7;

/**
 * Create a new invite token for the given user. Revokes any pending
 * invites for the same user before issuing — staff calling "Resend
 * invite" should not leave dangling links live.
 *
 * Returns the RAW token; only the email body should ever see it.
 */
export async function createInviteToken(
  context: any,
  params: {
    userId: string;
    invitedByUserId?: string | null;
    ttlDays?: number;
  },
): Promise<{ rawToken: string; expiresAt: Date }> {
  // The generated Prisma client doesn't surface the new
  // `userInviteToken` delegate until `prisma generate` runs as part of
  // the build. Same pattern used in password-reset.server.ts.
  const db = getPrisma(context) as any;
  const ttlDays = params.ttlDays ?? INVITE_TTL_DAYS;
  const rawToken = generateResetToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  // Revoke prior pending invites so only the freshest link is live.
  const now = new Date();
  await db.userInviteToken.updateMany({
    where: { userId: params.userId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });

  await db.userInviteToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
      invitedByUserId: params.invitedByUserId ?? null,
    },
  });

  return { rawToken, expiresAt };
}

export type InviteTokenLookup =
  | { ok: true; tokenId: string; userId: string; expiresAt: Date }
  | { ok: false; reason: "not-found" | "used" | "expired" | "revoked" };

/**
 * Look up an invite token by its raw value. Does NOT mark it used. Use
 * this from the GET handler to decide between rendering the form or an
 * error page.
 */
export async function lookupInviteToken(
  context: any,
  rawToken: string,
): Promise<InviteTokenLookup> {
  const db = getPrisma(context) as any;
  if (!rawToken) return { ok: false, reason: "not-found" };
  const tokenHash = await sha256Hex(rawToken);
  const row = await db.userInviteToken.findFirst({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "not-found" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  return { ok: true, tokenId: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

export type ConsumeInviteResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not-found" | "used" | "expired" | "revoked" };

/**
 * Mark the invite token as used. Call this from the action handler AFTER
 * the password has been written and BEFORE redirecting / signing the user
 * in. Single-use — a second call returns `{ ok: false, reason: "used" }`.
 */
export async function consumeInviteToken(
  context: any,
  rawToken: string,
): Promise<ConsumeInviteResult> {
  const db = getPrisma(context) as any;
  const lookup = await lookupInviteToken(context, rawToken);
  if (!lookup.ok) return lookup;
  await db.userInviteToken.update({
    where: { id: lookup.tokenId },
    data: { usedAt: new Date() },
  });
  return { ok: true, userId: lookup.userId };
}

/**
 * Revoke every pending invite for a user. Useful for staff "revoke
 * invite" / "resend" UI — call before issuing a fresh token.
 */
export async function revokePendingInvites(
  context: any,
  userId: string,
): Promise<number> {
  const db = getPrisma(context) as any;
  const result = await db.userInviteToken.updateMany({
    where: { userId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Build the full URL the invitee clicks. Anchors on the marketing origin
 * (apex) — the recipient may not know which tenant subdomain they belong
 * to, so the link must resolve from anywhere. Mirrors
 * `resetUrlFor` in `app/routes/auth/forgot-password.tsx`.
 */
export function buildInviteUrl(
  request: Request,
  context: any,
  rawToken: string,
): string {
  const base = marketingOriginFromRequest(request, context).replace(/\/$/, "");
  return `${base}/accept-invite?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Daily cleanup hook for the cron. Deletes fully-expired tokens older
 * than 14 days — same retention policy as PasswordResetToken (forensic
 * value for a couple of weeks, then garbage).
 */
export async function pruneExpiredInviteTokens(
  context: any,
  now: Date = new Date(),
): Promise<number> {
  const db = getPrisma(context) as any;
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const result = await db.userInviteToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
