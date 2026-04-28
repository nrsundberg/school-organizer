import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  signPresenceSample,
  verifyPresenceSample,
  PRESENCE_SAMPLE_MAX_SKEW_MS,
} from "./presence-sample-hmac";

const SECRET = "test-secret-do-not-use-in-prod";
const RUN_ID = "run_abc";

describe("presence-sample-hmac", () => {
  it("round-trips: a signature signed with the right secret verifies ok", async () => {
    const ts = new Date().toISOString();
    const hmac = await signPresenceSample(SECRET, RUN_ID, ts);
    const result = await verifyPresenceSample(SECRET, RUN_ID, {
      hmac,
      timestamp: ts,
    });
    assert.deepEqual(result, { ok: true });
  });

  it("produces a deterministic 64-char lowercase hex digest", async () => {
    const ts = "2026-04-28T00:00:00.000Z";
    const hmacA = await signPresenceSample(SECRET, RUN_ID, ts);
    const hmacB = await signPresenceSample(SECRET, RUN_ID, ts);
    assert.equal(hmacA, hmacB);
    assert.match(hmacA, /^[0-9a-f]{64}$/);
  });

  it("rejects a tampered hmac (correct length, wrong content)", async () => {
    const ts = new Date().toISOString();
    const hmac = await signPresenceSample(SECRET, RUN_ID, ts);
    // Flip a single hex char; result is still a valid-looking 64-char hex string.
    const tampered =
      hmac.slice(0, 0) + (hmac[0] === "0" ? "1" : "0") + hmac.slice(1);
    const result = await verifyPresenceSample(SECRET, RUN_ID, {
      hmac: tampered,
      timestamp: ts,
    });
    assert.deepEqual(result, { ok: false, reason: "bad-hmac" });
  });

  it("rejects when signed with a different secret", async () => {
    const ts = new Date().toISOString();
    const hmac = await signPresenceSample("other-secret", RUN_ID, ts);
    const result = await verifyPresenceSample(SECRET, RUN_ID, {
      hmac,
      timestamp: ts,
    });
    assert.deepEqual(result, { ok: false, reason: "bad-hmac" });
  });

  it("rejects when signed for a different runId", async () => {
    const ts = new Date().toISOString();
    const hmac = await signPresenceSample(SECRET, "other_run", ts);
    const result = await verifyPresenceSample(SECRET, RUN_ID, {
      hmac,
      timestamp: ts,
    });
    assert.deepEqual(result, { ok: false, reason: "bad-hmac" });
  });

  it("rejects timestamps skewed more than 60s from server time", async () => {
    const now = Date.parse("2026-04-28T00:00:00.000Z");
    const tooOld = new Date(now - PRESENCE_SAMPLE_MAX_SKEW_MS - 1).toISOString();
    const tooNew = new Date(now + PRESENCE_SAMPLE_MAX_SKEW_MS + 1).toISOString();
    const hmacOld = await signPresenceSample(SECRET, RUN_ID, tooOld);
    const hmacNew = await signPresenceSample(SECRET, RUN_ID, tooNew);
    const oldResult = await verifyPresenceSample(
      SECRET,
      RUN_ID,
      { hmac: hmacOld, timestamp: tooOld },
      now,
    );
    const newResult = await verifyPresenceSample(
      SECRET,
      RUN_ID,
      { hmac: hmacNew, timestamp: tooNew },
      now,
    );
    assert.deepEqual(oldResult, { ok: false, reason: "skew" });
    assert.deepEqual(newResult, { ok: false, reason: "skew" });
  });

  it("accepts timestamps within 60s of server time on either side", async () => {
    const now = Date.parse("2026-04-28T00:00:00.000Z");
    const slightlyOld = new Date(now - 30_000).toISOString();
    const slightlyNew = new Date(now + 30_000).toISOString();
    const hOld = await signPresenceSample(SECRET, RUN_ID, slightlyOld);
    const hNew = await signPresenceSample(SECRET, RUN_ID, slightlyNew);
    assert.deepEqual(
      await verifyPresenceSample(
        SECRET,
        RUN_ID,
        { hmac: hOld, timestamp: slightlyOld },
        now,
      ),
      { ok: true },
    );
    assert.deepEqual(
      await verifyPresenceSample(
        SECRET,
        RUN_ID,
        { hmac: hNew, timestamp: slightlyNew },
        now,
      ),
      { ok: true },
    );
  });

  it("rejects malformed (unparseable) timestamps", async () => {
    const result = await verifyPresenceSample(SECRET, RUN_ID, {
      hmac: "x".repeat(64),
      timestamp: "not-a-real-timestamp",
    });
    assert.deepEqual(result, { ok: false, reason: "bad-timestamp" });
  });
});
