/**
 * Pure PBKDF2 password hashing primitives. No database imports here —
 * kept separate from better-auth.server.ts so unit tests can exercise
 * it without pulling in Prisma / Cloudflare bindings.
 *
 * OWASP 2026 Password Storage Cheat Sheet recommends >= 600,000
 * iterations for PBKDF2-SHA-256. crypto.subtle.deriveBits is native in
 * the Cloudflare Workers runtime (and in Node 22+) so 600k finishes
 * comfortably under the Workers 30 ms CPU limit. If a given deployment
 * shows P50 > 8 ms on the free tier, drop to 300_000 — still above
 * the legacy 100k count and above OWASP's older 310k recommendation.
 * Because the iteration count is embedded in the stored hash, the
 * verifier tolerates any mix of old and new hashes.
 */

export const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH: HashAlgo = "sha256";
const PBKDF2_KEY_LEN = 32; // bytes

// Hashes stored before the v2 migration had no algorithm or iteration
// tag. Anything in `saltHex:keyHex` format is interpreted as
// PBKDF2-SHA-256 at 100k iters.
const LEGACY_ITERATIONS = 100_000;
const LEGACY_HASH: HashAlgo = "sha256";

export type HashAlgo = "sha256";

export type ParsedHash = {
  algo: HashAlgo;
  iterations: number;
  salt: Uint8Array;
  key: Uint8Array;
  format: "legacy" | "v2";
};

export type VerifyResult = {
  ok: boolean;
  /**
   * True when the verified hash used fewer iterations than the current
   * PBKDF2_ITERATIONS target, OR when it used the legacy `salt:key`
   * format. Callers should rehash the password with `hashPassword()`
   * and persist the new value.
   */
  needsRehash: boolean;
};

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const match = hex.match(/.{2}/g);
  if (!match) return new Uint8Array(0);
  return new Uint8Array(match.map((b) => parseInt(b, 16)));
}

function algoToSubtle(algo: HashAlgo): string {
  switch (algo) {
    case "sha256":
      return "SHA-256";
  }
}

async function pbkdf2Key(
  password: string,
  salt: Uint8Array,
  iterations: number,
  algo: HashAlgo,
  keyLenBytes: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: algoToSubtle(algo),
      salt: salt.buffer.slice(
        salt.byteOffset,
        salt.byteOffset + salt.byteLength,
      ) as ArrayBuffer,
      iterations,
    },
    key,
    keyLenBytes * 8,
  );
}

/**
 * Parse either the legacy `saltHex:keyHex` format or the versioned
 * `v2$<algo>$<iter>$<saltHex>$<keyHex>` format. Returns null if the
 * string is not a recognizable hash.
 */
export function parseStoredHash(stored: string): ParsedHash | null {
  if (!stored || typeof stored !== "string") return null;

  // v2 format: v2$sha256$600000$saltHex$keyHex
  if (stored.startsWith("v2$")) {
    const parts = stored.split("$");
    if (parts.length !== 5) return null;
    const [, algoStr, iterStr, saltHex, keyHex] = parts;
    if (algoStr !== "sha256") return null;
    const iterations = Number.parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations < 1) return null;
    const salt = fromHex(saltHex);
    const key = fromHex(keyHex);
    if (salt.length === 0 || key.length === 0) return null;
    return { algo: "sha256", iterations, salt, key, format: "v2" };
  }

  // Legacy format: saltHex:keyHex
  const [saltHex, keyHex, ...rest] = stored.split(":");
  if (!saltHex || !keyHex || rest.length > 0) return null;
  const salt = fromHex(saltHex);
  const key = fromHex(keyHex);
  if (salt.length === 0 || key.length === 0) return null;
  return {
    algo: LEGACY_HASH,
    iterations: LEGACY_ITERATIONS,
    salt,
    key,
    format: "legacy",
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Key(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_HASH,
    PBKDF2_KEY_LEN,
  );
  return `v2$sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<VerifyResult> {
  const parsed = parseStoredHash(hash);
  if (!parsed) return { ok: false, needsRehash: false };

  const bits = await pbkdf2Key(
    password,
    parsed.salt,
    parsed.iterations,
    parsed.algo,
    parsed.key.length,
  );
  const target = new Uint8Array(bits);
  const stored = parsed.key;
  if (target.length !== stored.length) {
    return { ok: false, needsRehash: false };
  }

  // Constant-time compare — preserve the XOR-accumulate loop so a
  // short-circuit optimization can't leak position-of-first-mismatch.
  let diff = 0;
  for (let i = 0; i < target.length; i++) diff |= target[i] ^ stored[i];
  const ok = diff === 0;

  const needsRehash =
    ok &&
    (parsed.format === "legacy" ||
      parsed.algo !== "sha256" ||
      parsed.iterations < PBKDF2_ITERATIONS);

  return { ok, needsRehash };
}

/**
 * Thin boolean-returning wrapper for callers (like better-auth's
 * adapter) that expect `verify` to return a plain boolean. Use
 * `verifyPassword` directly when you need the `needsRehash` signal.
 */
export async function verifyPasswordBool(
  hash: string,
  password: string,
): Promise<boolean> {
  const { ok } = await verifyPassword(hash, password);
  return ok;
}
