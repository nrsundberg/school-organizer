import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, clientIpFromRequest } from "./rate-limit.server";

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

test("checkRateLimit: limiter returns success:true → ok:true", async () => {
  const limiter: RateLimit = {
    limit: async () => ({ success: true }),
  };
  const result = await checkRateLimit({ limiter, key: "test-key" });
  assert.deepEqual(result, { ok: true });
});

test("checkRateLimit: limiter returns success:false → ok:false with retryAfter:60", async () => {
  const limiter: RateLimit = {
    limit: async () => ({ success: false }),
  };
  const result = await checkRateLimit({ limiter, key: "test-key" });
  assert.deepEqual(result, { ok: false, retryAfter: 60 });
});

test("checkRateLimit: undefined limiter with defaultAllow (default) → ok:true", async () => {
  const result = await checkRateLimit({ limiter: undefined, key: "test-key" });
  assert.deepEqual(result, { ok: true });
});

test("checkRateLimit: undefined limiter with defaultAllow:true → ok:true", async () => {
  const result = await checkRateLimit({
    limiter: undefined,
    key: "test-key",
    defaultAllow: true,
  });
  assert.deepEqual(result, { ok: true });
});

test("checkRateLimit: undefined limiter with defaultAllow:false → ok:false with retryAfter:60", async () => {
  const result = await checkRateLimit({
    limiter: undefined,
    key: "test-key",
    defaultAllow: false,
  });
  assert.deepEqual(result, { ok: false, retryAfter: 60 });
});

// ---------------------------------------------------------------------------
// clientIpFromRequest
// ---------------------------------------------------------------------------

test("clientIpFromRequest: reads CF-Connecting-IP header", () => {
  const req = new Request("https://example.com/", {
    headers: {
      "CF-Connecting-IP": "1.2.3.4",
      "X-Forwarded-For": "9.9.9.9, 8.8.8.8",
    },
  });
  assert.equal(clientIpFromRequest(req), "1.2.3.4");
});

test("clientIpFromRequest: falls back to first hop of X-Forwarded-For", () => {
  const req = new Request("https://example.com/", {
    headers: {
      "X-Forwarded-For": "5.6.7.8, 10.0.0.1",
    },
  });
  assert.equal(clientIpFromRequest(req), "5.6.7.8");
});

test("clientIpFromRequest: returns 'unknown' when no IP headers present", () => {
  const req = new Request("https://example.com/");
  assert.equal(clientIpFromRequest(req), "unknown");
});
