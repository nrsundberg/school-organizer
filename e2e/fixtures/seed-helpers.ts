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
