import {
  hashPassword,
  sharedSessionCookieDomain,
  verifyPassword,
} from "~/domain/auth/better-auth.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";

const VIEWER_FID_COOKIE = "pickuproster_viewer_fid";
const VIEWER_SESSION_COOKIE = "pickuproster_viewer_session";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VIEWER_SESSION_DAYS = 180;

type Ctx = { request: Request; context: any };

function parseCookies(request: Request): Map<string, string> {
  const raw = request.headers.get("cookie") ?? "";
  const out = new Map<string, string>();
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k || rest.length === 0) continue;
    out.set(k, decodeURIComponent(rest.join("=")));
  }
  return out;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

function cookieAttr(context: any) {
  const env = context?.cloudflare?.env ?? process.env;
  const isProd = env.ENVIRONMENT !== "development";
  const domain = sharedSessionCookieDomain(context);
  const domainPart = domain ? `; Domain=${domain}` : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${VIEWER_SESSION_DAYS * ONE_DAY_MS / 1000}${isProd ? "; Secure" : ""}${domainPart}`;
}

function ipFromRequest(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  return xff.split(",")[0]?.trim() || "unknown";
}

function ipHint(ip: string): string {
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts[0]}:${parts[1]}::`;
  }
  return "unknown";
}

async function getOrCreateFingerprint({ request, context }: Ctx): Promise<{ clientKey: string; setCookie?: string; ipHint: string }> {
  const cookies = parseCookies(request);
  let fid = cookies.get(VIEWER_FID_COOKIE);
  let setCookie: string | undefined;
  if (!fid) {
    fid = randomToken(16);
    setCookie = `${VIEWER_FID_COOKIE}=${encodeURIComponent(fid)}; ${cookieAttr(context)}`;
  }
  const ip = ipFromRequest(request);
  const clientKey = await sha256Hex(`${fid}:${ip}`);
  return { clientKey, setCookie, ipHint: ipHint(ip) };
}

export async function hasValidViewerAccess({ request, context }: Ctx): Promise<boolean> {
  const prisma = getTenantPrisma(context);
  const cookies = parseCookies(request);
  const token = cookies.get(VIEWER_SESSION_COOKIE);
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const session = await prisma.viewerAccessSession.findFirst({ where: { tokenHash } });
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt <= now) return false;
  return true;
}

export async function getViewerLockState(ctx: Ctx): Promise<{ locked: boolean; message: string | null; setCookie?: string }> {
  const prisma = getTenantPrisma(ctx.context);
  const { clientKey, setCookie } = await getOrCreateFingerprint(ctx);
  const now = new Date();
  const row = await prisma.viewerAccessAttempt.findFirst({ where: { clientKey } });
  if (!row) return { locked: false, message: null, setCookie };
  if (row.requiresAdminReset) {
    return { locked: true, message: "Too many failed attempts. Access is locked until an admin resets it.", setCookie };
  }
  if (row.lockedUntil && row.lockedUntil > now) {
    return {
      locked: true,
      message: `Too many failed attempts. Try again after ${row.lockedUntil.toLocaleString()}.`,
      setCookie,
    };
  }
  return { locked: false, message: null, setCookie };
}

async function createViewerSession(context: any, source: "pin" | "magic"): Promise<{ token: string; expiresAt: Date }> {
  const prisma = getTenantPrisma(context);
  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + VIEWER_SESSION_DAYS * ONE_DAY_MS);
  await prisma.viewerAccessSession.create({
    data: {
      tokenHash,
      source,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function verifyViewerPinAndIssueSession(ctx: Ctx, pin: string): Promise<{ ok: true; headers: Headers } | { ok: false; message: string; headers: Headers }> {
  const prisma = getTenantPrisma(ctx.context);
  const headers = new Headers();
  const lock = await getViewerLockState(ctx);
  if (lock.setCookie) headers.append("Set-Cookie", lock.setCookie);
  if (lock.locked) {
    return { ok: false, message: lock.message ?? "Access temporarily locked.", headers };
  }

  const appSettings = await prisma.appSettings.findFirst();
  const pinHash = appSettings?.viewerPinHash;
  if (!pinHash) {
    return { ok: false, message: "Viewer PIN is not configured yet. Contact an admin.", headers };
  }

  const { ok: valid, needsRehash } = await verifyPassword(pinHash, pin);
  const { clientKey, ipHint: hint } = await getOrCreateFingerprint(ctx);
  const now = new Date();

  if (valid && needsRehash) {
    // Transparent upgrade: legacy / low-iter hash verified, rotate to
    // the current PBKDF2_ITERATIONS target. Fire-and-forget via
    // waitUntil on Workers, otherwise await.
    const task = (async () => {
      try {
        const newHash = await hashPassword(pin);
        await prisma.appSettings.updateMany({
          where: { viewerPinHash: pinHash },
          data: { viewerPinHash: newHash },
        });
      } catch (err) {
        // Best-effort; the next successful PIN entry will retry.
        // eslint-disable-next-line no-console
        console.error("[viewer-pin-rehash] failed to persist", err);
      }
    })();
    const cfCtx = (ctx.context as any)?.cloudflare?.ctx;
    if (cfCtx && typeof cfCtx.waitUntil === "function") {
      cfCtx.waitUntil(task);
    } else {
      await task;
    }
  }

  if (!valid) {
    const existing = await prisma.viewerAccessAttempt.findFirst({ where: { clientKey } });
    const attempts = (existing?.failedCount ?? 0) + 1;
    const persistAttempt = async (data: {
      failedCount: number;
      stage: number;
      requiresAdminReset?: boolean;
      lockedUntil?: Date | null;
      lastFailedAt: Date;
      ipHint: string;
    }) => {
      if (existing) {
        await prisma.viewerAccessAttempt.updateMany({ where: { clientKey }, data });
      } else {
        await prisma.viewerAccessAttempt.create({ data: { clientKey, ...data } });
      }
    };
    if (attempts >= 4) {
      if ((existing?.stage ?? 0) >= 1) {
        await persistAttempt({
          failedCount: attempts,
          stage: 2,
          requiresAdminReset: true,
          lockedUntil: null,
          lastFailedAt: now,
          ipHint: hint,
        });
        return { ok: false, message: "Too many failed attempts. Access is now locked until an admin resets it.", headers };
      }
      await persistAttempt({
        failedCount: attempts,
        stage: 1,
        lockedUntil: new Date(Date.now() + ONE_DAY_MS),
        requiresAdminReset: false,
        lastFailedAt: now,
        ipHint: hint,
      });
      return { ok: false, message: "Too many failed attempts. Locked for 24 hours.", headers };
    }
    await persistAttempt({ failedCount: attempts, stage: 0, lastFailedAt: now, ipHint: hint });
    return { ok: false, message: `Invalid PIN. ${Math.max(0, 4 - attempts)} attempts left.`, headers };
  }

  await prisma.viewerAccessAttempt.deleteMany({ where: { clientKey } });
  const session = await createViewerSession(ctx.context, "pin");
  headers.append("Set-Cookie", `${VIEWER_SESSION_COOKIE}=${encodeURIComponent(session.token)}; ${cookieAttr(ctx.context)}`);
  return { ok: true, headers };
}

export async function setViewerPin(context: any, pin: string): Promise<void> {
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const hash = await hashPassword(pin);
  await prisma.appSettings.upsert({
    where: { orgId: org.id },
    update: { viewerPinHash: hash },
    create: { viewerDrawingEnabled: false, viewerPinHash: hash },
  });
}

export async function revokeAllViewerSessions(context: any): Promise<number> {
  const prisma = getTenantPrisma(context);
  const now = new Date();
  const result = await prisma.viewerAccessSession.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}

export async function resetViewerLock(context: any, clientKey: string): Promise<void> {
  const prisma = getTenantPrisma(context);
  await prisma.viewerAccessAttempt.deleteMany({ where: { clientKey } });
}

export async function createViewerMagicLink(context: any, createdByUserId: string | null, daysValid: number): Promise<string> {
  const prisma = getTenantPrisma(context);
  const rawToken = randomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  await prisma.viewerMagicLink.create({
    data: {
      tokenHash,
      expiresAt: new Date(Date.now() + Math.max(1, daysValid) * ONE_DAY_MS),
      createdByUserId,
    },
  });
  return rawToken;
}

export async function consumeViewerMagicLink(ctx: Ctx, rawToken: string): Promise<{ ok: true; headers: Headers } | { ok: false; message: string; headers: Headers }> {
  const prisma = getTenantPrisma(ctx.context);
  const headers = new Headers();
  const tokenHash = await sha256Hex(rawToken);
  const now = new Date();
  const row = await prisma.viewerMagicLink.findFirst({ where: { tokenHash } });
  if (!row) return { ok: false, message: "Magic link is invalid.", headers };
  if (row.revokedAt) return { ok: false, message: "Magic link has been revoked.", headers };
  if (row.usedAt) return { ok: false, message: "Magic link has already been used.", headers };
  if (row.expiresAt <= now) return { ok: false, message: "Magic link has expired.", headers };

  await prisma.viewerMagicLink.update({ where: { id: row.id }, data: { usedAt: now } });
  const session = await createViewerSession(ctx.context, "magic");
  headers.append("Set-Cookie", `${VIEWER_SESSION_COOKIE}=${encodeURIComponent(session.token)}; ${cookieAttr(ctx.context)}`);
  return { ok: true, headers };
}

export function clearViewerSessionCookie(context: any): string {
  const env = context?.cloudflare?.env ?? process.env;
  const isProd = env.ENVIRONMENT !== "development";
  const domain = sharedSessionCookieDomain(context);
  const domainPart = domain ? `; Domain=${domain}` : "";
  return `${VIEWER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}${domainPart}`;
}
