/**
 * Pure PBKDF2 password hashing primitives. No database imports here —
 * kept separate from better-auth.server.ts so unit tests can exercise
 * it without pulling in Prisma / Cloudflare bindings.
 *
 * OWASP 2026 Password Storage Cheat Sheet recommends >= 600,000
 * iterations for PBKDF2-SHA-256. Cloudflare Workers (workerd) has
 * historically refused any single `crypto.subtle.deriveBits` call with
 * `iterations` > 100_000 (see cloudflare/workerd#1346) — exceeding the
 * cap throws a DOMException that surfaces to clients as a bare 500.
 * The cap appears to have been lifted in recent open-source workerd
 * builds (a 2026-04-24 build accepts 1M iterations locally), but the
 * Cloudflare production fleet may still enforce it at any point in
 * time since the OSS tip rolls to prod on Cloudflare's own schedule.
 *
 * Rather than gamble on runtime version, we do the derivation in
 * chunks of ≤ PBKDF2_MAX_ITERATIONS_PER_CALL and feed each chunk's
 * output forward as the salt for the next (salt-chained PBKDF2). This
 * works on both capped and uncapped runtimes for the same total CPU
 * cost, and removes the iteration cap as a failure mode permanently.
 *
 * Why salt-chaining instead of a single deriveBits(600_000) call:
 * splitting the work into N sequential PBKDF2 chunks forces an
 * attacker to perform the same N chunks to test any candidate
 * password, so the effective work factor is the SUM of the chunk
 * iterations (600k here). The PRF (HMAC-SHA-256) is deterministic in
 * (key, message), and we never expose intermediate outputs, so
 * chaining via salt is cryptographically sound for password
 * verification. It is *not* byte-equivalent to a single
 * deriveBits(600000) call — the hash bytes differ — which is why
 * the verifier uses the same chunking routine as the hasher.
 *
 * Because the total iteration count is embedded in the stored hash,
 * the verifier tolerates any mix of old and new hashes and the
 * `needsRehash` flag drives transparent upgrades on login.
 */

export const PBKDF2_ITERATIONS = 600_000;
/**
 * workerd's hard cap on a single PBKDF2 deriveBits call. Node has no
 * such cap, so the same chunked routine runs in both environments —
 * tests and production share the code path.
 */
export const PBKDF2_MAX_ITERATIONS_PER_CALL = 100_000;
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

function uint8ArrayToArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(
    u.byteOffset,
    u.byteOffset + u.byteLength,
  ) as ArrayBuffer;
}

/**
 * Derive `keyLenBytes` bytes by chaining sequential PBKDF2 calls, each
 * capped at PBKDF2_MAX_ITERATIONS_PER_CALL. The first call uses `salt`;
 * each subsequent call uses the previous call's output as its salt.
 * Sum of per-call iteration counts equals the requested total.
 *
 * Exported for tests so synthetic stored hashes at arbitrary iteration
 * counts exactly match what the production verifier will compute.
 * @internal
 */
export async function pbkdf2KeyBytes(
  password: string,
  salt: Uint8Array,
  totalIterations: number,
  algo: HashAlgo,
  keyLenBytes: number,
): Promise<ArrayBuffer> {
  if (!Number.isInteger(totalIterations) || totalIterations < 1) {
    throw new Error(
      `pbkdf2KeyBytes: iterations must be a positive integer, got ${totalIterations}`,
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = algoToSubtle(algo);
  const keyLenBits = keyLenBytes * 8;

  let currentSalt: ArrayBuffer = uint8ArrayToArrayBuffer(salt);
  let remaining = totalIterations;
  let lastOutput: ArrayBuffer | null = null;

  while (remaining > 0) {
    const chunk = Math.min(remaining, PBKDF2_MAX_ITERATIONS_PER_CALL);
    lastOutput = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash, salt: currentSalt, iterations: chunk },
      key,
      keyLenBits,
    );
    currentSalt = lastOutput;
    remaining -= chunk;
  }

  // Loop runs at least once because totalIterations >= 1, so lastOutput
  // is never null. Assert for the type checker.
  if (lastOutput === null) {
    throw new Error("pbkdf2KeyBytes: derivation produced no output");
  }
  return lastOutput;
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
  const bits = await pbkdf2KeyBytes(
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

  const bits = await pbkdf2KeyBytes(
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
