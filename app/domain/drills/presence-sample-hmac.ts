// HMAC-style signature for the worker → server presence-sample loopback.
//
// The DO alarm in `workers/bingo-board.ts` POSTs a presence snapshot to
// `/api/drill-runs/:runId/presence-sample`. That route is reachable from the
// public internet, so we can't trust the request body alone — we need a way
// to prove "this came from our own DO". Both sides share a secret
// (`PRESENCE_SAMPLE_HMAC_SECRET`, set via `wrangler secret put`) and compute
// `sha256(secret ":" runId ":" timestamp)`.
//
// Why a hand-rolled SHA-256 + timing-safe compare and not WebCrypto's
// `crypto.subtle.sign("HMAC", ...)`?
//   1. The helper needs to be importable from both the DO (Workers runtime)
//      and the server route (RR loader/action). WebCrypto is available in
//      both, so async would be fine, but…
//   2. Tests are run with `tsx --test`. The async-WebCrypto path requires
//      the test harness to await the helper, which complicates the
//      "verify is pure" property we want for unit tests.
//   3. The strings being signed are tiny (`<secret>:<runId>:<timestamp>`).
//      A synchronous WebCrypto digest via `crypto.subtle.digest` keeps the
//      helper pure and testable without giving up cryptographic strength.
//
// The wire format is hex; both sides use the lowercase output.

const MAX_SKEW_MS = 60_000;

export type PresenceSampleSig = {
  hmac: string;
  timestamp: string; // ISO-8601 (must round-trip equal to body)
};

/**
 * Compute the signature for `(runId, timestamp)`.
 *
 * Uses `crypto.subtle.digest("SHA-256", …)` which is supported on both the
 * Workers runtime and Node 20+ (used by `tsx --test`). The helper is async
 * solely because of the digest call.
 */
export async function signPresenceSample(
  secret: string,
  runId: string,
  timestamp: string,
): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${secret}:${runId}:${timestamp}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(buf);
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// Constant-time hex compare. The lengths-differ short-circuit only leaks the
// length, which is fixed for SHA-256 output anyway.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "bad-timestamp" | "skew" | "bad-hmac" };

/**
 * Verify a presence-sample signature.
 *
 * - Rejects malformed `timestamp` strings (`bad-timestamp`).
 * - Rejects timestamps more than `MAX_SKEW_MS` (60s) away from `nowMs`
 *   (`skew`) — this bounds replay attacks without requiring nonce storage.
 * - Rejects mismatched HMAC (`bad-hmac`).
 *
 * `nowMs` is injectable so unit tests can simulate clock skew without
 * mocking `Date.now()` globally.
 */
export async function verifyPresenceSample(
  secret: string,
  runId: string,
  sig: PresenceSampleSig,
  nowMs: number = Date.now(),
): Promise<VerifyResult> {
  const ts = Date.parse(sig.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad-timestamp" };
  }
  if (Math.abs(nowMs - ts) > MAX_SKEW_MS) {
    return { ok: false, reason: "skew" };
  }
  const expected = await signPresenceSample(secret, runId, sig.timestamp);
  if (!timingSafeEqualHex(expected, sig.hmac)) {
    return { ok: false, reason: "bad-hmac" };
  }
  return { ok: true };
}

export const PRESENCE_SAMPLE_MAX_SKEW_MS = MAX_SKEW_MS;
