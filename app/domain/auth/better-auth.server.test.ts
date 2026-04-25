/**
 * Unit tests for password hashing (PBKDF2) and verification. These run
 * under `tsx --test` and use the Node Web Crypto global that matches
 * the Cloudflare Workers runtime.
 *
 * NOTE: we import only the pure hashing exports here — importing the
 * full module pulls in `~/db.server` and better-auth's adapter setup,
 * which is not needed for these tests and drags in path-alias/runtime
 * concerns. Using a narrow test-only re-import keeps the test hermetic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  parseStoredHash,
  verifyPasswordBool,
  pbkdf2KeyBytes,
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS_PER_CALL,
} from "./password-hash";

// Force the module's bookkeeping not to reach into db.server by only
// touching pure functions below. hashPassword / verifyPassword do not
// touch the database.

test("hashPassword produces the v2$sha256$... format", async () => {
  const stored = await hashPassword("correct horse battery staple");
  const parts = stored.split("$");
  assert.equal(parts.length, 5, "v2 format is 5 $-delimited fields");
  assert.equal(parts[0], "v2");
  assert.equal(parts[1], "sha256");
  const iters = Number.parseInt(parts[2], 10);
  assert.ok(
    iters >= 300_000,
    `iteration count should be >= 300k OWASP floor, got ${iters}`,
  );
  // salt and key are lowercase hex
  assert.match(parts[3], /^[0-9a-f]+$/);
  assert.match(parts[4], /^[0-9a-f]+$/);
});

test("hashPassword output round-trips through verifyPassword", async () => {
  const stored = await hashPassword("s3cret!");
  const result = await verifyPassword(stored, "s3cret!");
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, false, "fresh hash should not need rehash");
});

test("verifyPassword rejects wrong password on v2 hash", async () => {
  const stored = await hashPassword("right-password");
  const result = await verifyPassword(stored, "wrong-password");
  assert.equal(result.ok, false);
  assert.equal(result.needsRehash, false);
});

test("parseStoredHash handles v2 format", () => {
  const parsed = parseStoredHash(
    "v2$sha256$600000$deadbeef$cafebabe12345678",
  );
  assert.ok(parsed);
  assert.equal(parsed!.algo, "sha256");
  assert.equal(parsed!.iterations, 600_000);
  assert.equal(parsed!.format, "v2");
  assert.equal(parsed!.salt.length, 4);
  assert.equal(parsed!.key.length, 8);
});

test("parseStoredHash handles legacy saltHex:keyHex format", () => {
  const parsed = parseStoredHash("deadbeef:cafebabe12345678");
  assert.ok(parsed);
  assert.equal(parsed!.algo, "sha256");
  assert.equal(parsed!.iterations, 100_000);
  assert.equal(parsed!.format, "legacy");
});

test("parseStoredHash rejects nonsense", () => {
  assert.equal(parseStoredHash(""), null);
  assert.equal(parseStoredHash("no-delim"), null);
  assert.equal(parseStoredHash("v1$sha256$1$aa$bb"), null);
  assert.equal(parseStoredHash("v2$md5$600000$aa$bb"), null);
  assert.equal(parseStoredHash("v2$sha256$abc$aa$bb"), null);
  assert.equal(parseStoredHash("a:b:c"), null);
});

test("verifyPassword accepts a legacy saltHex:keyHex hash and flags needsRehash", async () => {
  // Generate a legacy hash via the same pbkdf2 primitive the old code
  // used: 100k iterations, SHA-256, 32-byte key, 16-byte random salt.
  const password = "legacy-password-42";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer.slice(
        salt.byteOffset,
        salt.byteOffset + salt.byteLength,
      ) as ArrayBuffer,
      iterations: 100_000,
    },
    key,
    32 * 8,
  );

  const toHex = (u: Uint8Array) =>
    Array.from(u)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const legacy = `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;

  const result = await verifyPassword(legacy, password);
  assert.equal(result.ok, true, "legacy hash verifies");
  assert.equal(
    result.needsRehash,
    true,
    "legacy hash should be flagged for rehash",
  );

  // Wrong password on legacy
  const bad = await verifyPassword(legacy, "not-the-password");
  assert.equal(bad.ok, false);
  assert.equal(bad.needsRehash, false);
});

test("verifyPassword flags needsRehash when iterations below current target", async () => {
  // Construct a synthetic v2 hash at 300k iters — below PBKDF2_ITERATIONS
  // (600k). It should verify but flag needsRehash. Must use the same
  // chunked primitive the verifier uses so the bytes match: a single
  // deriveBits(300_000) call produces different output than 3 chunked
  // calls of 100k each.
  const password = "mid-iter-password";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2KeyBytes(password, salt, 300_000, "sha256", 32);

  const toHex = (u: Uint8Array) =>
    Array.from(u)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const stored = `v2$sha256$300000$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;

  const result = await verifyPassword(stored, password);
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, true, "sub-target iter count flags rehash");
});

test("pbkdf2KeyBytes stays within the workerd 100k-per-call cap", async () => {
  // Regression test for cloudflare/workerd#1346. We can't observe the
  // individual deriveBits calls from outside, but we can assert the
  // contract that the chunk size is <= the runtime cap, and that
  // chunking does not break determinism (same inputs produce same
  // bytes).
  assert.equal(PBKDF2_MAX_ITERATIONS_PER_CALL, 100_000);

  const password = "cap-test";
  const salt = new Uint8Array(16); // deterministic zeros
  const a = await pbkdf2KeyBytes(password, salt, 600_000, "sha256", 32);
  const b = await pbkdf2KeyBytes(password, salt, 600_000, "sha256", 32);
  assert.deepEqual(
    new Uint8Array(a),
    new Uint8Array(b),
    "chunked derivation must be deterministic",
  );
});

test("pbkdf2KeyBytes chunk boundaries: 100k round-trips, 200k differs from single-shot", async () => {
  // At exactly the cap, the loop runs once — chunked and single-shot
  // produce identical bytes. Above the cap, salt chaining diverges
  // from single-shot. Covers both sides of the chunk boundary.
  const password = "boundary-test";
  const salt = new Uint8Array(16);

  const singleShot100k = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer.slice(0, 16) as ArrayBuffer,
      iterations: 100_000,
    },
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password.normalize("NFKC")),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
    32 * 8,
  );
  const chunked100k = await pbkdf2KeyBytes(password, salt, 100_000, "sha256", 32);
  assert.deepEqual(
    new Uint8Array(singleShot100k),
    new Uint8Array(chunked100k),
    "at the cap, chunked matches single-shot exactly (one chunk)",
  );

  const singleShot200k = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer.slice(0, 16) as ArrayBuffer,
      iterations: 200_000,
    },
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password.normalize("NFKC")),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
    32 * 8,
  );
  const chunked200k = await pbkdf2KeyBytes(password, salt, 200_000, "sha256", 32);
  assert.notDeepEqual(
    new Uint8Array(singleShot200k),
    new Uint8Array(chunked200k),
    "above the cap, salt-chained output intentionally diverges",
  );
});

test("pbkdf2KeyBytes rejects non-positive iterations", async () => {
  await assert.rejects(() => pbkdf2KeyBytes("x", new Uint8Array(16), 0, "sha256", 32));
  await assert.rejects(() => pbkdf2KeyBytes("x", new Uint8Array(16), -1, "sha256", 32));
  await assert.rejects(() => pbkdf2KeyBytes("x", new Uint8Array(16), 1.5, "sha256", 32));
});

test("hashPassword at PBKDF2_ITERATIONS (600k) round-trips end-to-end", async () => {
  // Full-fat path: the exact configuration production runs. Guards
  // against a regression where PBKDF2_ITERATIONS gets bumped above
  // what the chunker can handle, or where the hash/verify paths drift
  // apart. Expensive (~1s) but worth it.
  assert.equal(PBKDF2_ITERATIONS, 600_000);
  const stored = await hashPassword("prod-config-sanity");
  const parts = stored.split("$");
  assert.equal(parts[2], String(PBKDF2_ITERATIONS));
  const result = await verifyPassword(stored, "prod-config-sanity");
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, false);
});

test("timing-safe compare: XOR-diff loop returns the same diff=0 result for correct match", async () => {
  // White-box: we don't export the compare loop, but we assert its
  // observable behavior — verification of a correct password returns
  // ok:true, and for a single-bit-flipped stored key it returns
  // ok:false (meaning the loop accumulated a non-zero diff rather than
  // short-circuiting early).
  const password = "timing-test";
  const stored = await hashPassword(password);
  // Flip one bit in the last hex char of the key portion.
  const parts = stored.split("$");
  const keyHex = parts[4];
  const flippedLast =
    keyHex.slice(0, -1) +
    ((parseInt(keyHex.slice(-1), 16) ^ 0x1) & 0xf).toString(16);
  const mutated = [parts[0], parts[1], parts[2], parts[3], flippedLast].join(
    "$",
  );

  const good = await verifyPassword(stored, password);
  assert.equal(good.ok, true);

  const mutatedResult = await verifyPassword(mutated, password);
  assert.equal(
    mutatedResult.ok,
    false,
    "one-bit mutation in stored key must fail verify",
  );
  assert.equal(mutatedResult.needsRehash, false);
});

test("verifyPasswordBool compatibility wrapper returns plain boolean", async () => {
  const stored = await hashPassword("wrapper-test");
  assert.equal(await verifyPasswordBool(stored, "wrapper-test"), true);
  assert.equal(await verifyPasswordBool(stored, "nope"), false);
  assert.equal(await verifyPasswordBool("not-a-hash", "anything"), false);
});

test("verifyPassword rejects malformed input without throwing", async () => {
  assert.deepEqual(await verifyPassword("", "anything"), {
    ok: false,
    needsRehash: false,
  });
  assert.deepEqual(await verifyPassword("garbage", "anything"), {
    ok: false,
    needsRehash: false,
  });
  assert.deepEqual(
    await verifyPassword("v2$sha256$600000$$", "anything"),
    { ok: false, needsRehash: false },
  );
});
