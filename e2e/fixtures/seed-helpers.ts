/**
 * Shared seeding primitives used by both `scripts/seed.ts` (the human-run
 * dev-user seeder) and `e2e/fixtures/seeded-tenant.ts` (the Playwright
 * fixture that stands up a fresh org per spec).
 *
 * Keeping these two in lockstep matters because the same PBKDF2 parameters
 * must match `app/domain/auth/better-auth.server.ts` — otherwise a seeded
 * password won't verify against the live hash path.
 *
 * See `app/domain/auth/better-auth.server.ts:34-51` for the canonical
 * hashPassword/verifyPassword implementation. This module exists so the
 * e2e tests can insert auth rows directly into `file:./dev.db` without
 * pulling the whole Better Auth + Prisma + D1 runtime into a Node test
 * process.
 */
import * as fs from "node:fs";
import * as path from "node:path";

// Must match PBKDF2 params in app/domain/auth/better-auth.server.ts.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_KEY_LEN = 32; // bytes

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pbkdf2Key(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS },
    key,
    PBKDF2_KEY_LEN * 8,
  );
}

/**
 * Produces the `"<salt-hex>:<key-hex>"` shape the repo uses for both the
 * Better Auth `Account.password` column and the `AppSettings.viewerPinHash`
 * column. Safe to use for anything that will later be verified via
 * `verifyPassword()` from `app/domain/auth/better-auth.server.ts`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Key(password, salt);
  return `${toHex(salt.buffer)}:${toHex(bits)}`;
}

/**
 * 24-char base64-ish id (slash/plus stripped) used for User, Account,
 * Session, and Org ids throughout the seeded-tenant fixture. Matches
 * the shape `scripts/seed.ts` generates so a seeded e2e admin row is
 * indistinguishable from a hand-seeded one.
 */
export function generateId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "0")
    .replace(/\//g, "0")
    .slice(0, 24);
}

/**
 * Random hex token, default 24 bytes (48 hex chars). Used for Better Auth
 * session tokens and for generating unique per-spec slugs so parallel
 * Playwright workers don't clobber each other.
 */
export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

/**
 * Short lowercase slug suitable for a tenant host segment. 6 chars of
 * base36 is ~2B namespace — collision during a single CI run is
 * effectively impossible.
 */
export function shortSlug(prefix = "e2e"): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = toHex(bytes.buffer);
  return `${prefix}-${parseInt(hex, 16).toString(36)}`;
}

/**
 * Produce the wire-format cookie value better-auth's admin/session APIs
 * expect: `URL_ENCODED(<value>.<base64-hmac-sha256>)`.
 *
 * Mirrors `signCookieValue` in
 * `node_modules/better-auth/node_modules/better-call/dist/crypto.mjs`.
 * The server reads the cookie via `ctx.getSignedCookie(name, secret)`,
 * which percent-decodes, finds the last `.`, base64-verifies the
 * trailing 44-char signature against the leading value, and then
 * looks up the session by the leading value. So unsigned tokens are
 * rejected even when the cookie name matches.
 *
 * Used by specs that seed a session row directly in D1 and need to
 * present it as if better-auth's own login flow had set it.
 */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  // btoa(String.fromCharCode(...bytes)) — same encoding better-call uses.
  let sigBin = "";
  const sigBytes = new Uint8Array(sigBuf);
  for (let i = 0; i < sigBytes.length; i++) sigBin += String.fromCharCode(sigBytes[i]);
  const signature = btoa(sigBin);
  return encodeURIComponent(`${value}.${signature}`);
}

/**
 * Cookie name better-auth expects on the wire for the session token.
 * In production-like envs (`useSecureCookies: true`), better-auth
 * prefixes `__Secure-`. Wrangler dev with `ENVIRONMENT=production`
 * (the default in `wrangler.jsonc`'s `vars`) is one such env, so the
 * fixture has to honor that prefix or the server never finds the
 * session and bounces every authenticated request to /login.
 *
 * `useSecureCookies` is read from the env the same way
 * `getAuth(context)` reads it — `env.ENVIRONMENT !== "development"`.
 */
export function sessionCookieName(opts: {
  cookiePrefix?: string;
  useSecureCookies?: boolean;
} = {}): string {
  const prefix = opts.cookiePrefix ?? "pickuproster";
  const secure = opts.useSecureCookies ?? true;
  const base = `${prefix}.session_token`;
  return secure ? `__Secure-${base}` : base;
}

/**
 * Read `BETTER_AUTH_SECRET` from `.dev.vars` (the same file the CI
 * workflow writes before starting `wrangler dev`). Falls back to the
 * `BETTER_AUTH_SECRET` env var so a developer running specs against
 * a non-default secret can override.
 *
 * Throws when neither is set — without the secret we cannot mint a
 * cookie better-auth will accept, and a silently-empty secret would
 * just produce the same `expect 302 got /login` failure with no clue
 * why.
 */
export function readBetterAuthSecret(devVarsPath = ".dev.vars"): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const candidates = [
    path.resolve(devVarsPath),
    path.resolve(process.cwd(), devVarsPath),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== "BETTER_AUTH_SECRET") continue;
      let val = trimmed.slice(eq + 1).trim();
      // Strip optional surrounding quotes.
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) return val;
    }
  }
  throw new Error(
    "readBetterAuthSecret: BETTER_AUTH_SECRET not set and not found in .dev.vars. " +
      "Specs that seed a session row directly need the same secret wrangler dev is using to verify the cookie signature.",
  );
}
