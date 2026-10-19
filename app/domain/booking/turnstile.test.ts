import test from "node:test";
import assert from "node:assert/strict";
import { verifyTurnstile } from "./turnstile";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Turnstile accepts a successful token for the expected action and host", async () => {
  const decision = await verifyTurnstile({
    secret: "secret",
    token: "token",
    expectedAction: "demo",
    expectedHostnames: ["pickuproster.com"],
    environment: "production",
    fetchImpl: async () =>
      jsonResponse({ success: true, action: "demo", hostname: "pickuproster.com" }),
  });
  assert.deepEqual(decision, { ok: true, skipped: false });
});

test("Turnstile rejects a failed check, the wrong action, and the wrong host", async () => {
  const cases = [
    { success: false, action: "demo", hostname: "pickuproster.com" },
    { success: true, action: "intro", hostname: "pickuproster.com" },
    { success: true, action: "demo", hostname: "evil.example" },
  ];
  for (const body of cases) {
    const decision = await verifyTurnstile({
      secret: "secret",
      token: "token",
      expectedAction: "demo",
      expectedHostnames: ["pickuproster.com"],
      environment: "production",
      fetchImpl: async () => jsonResponse(body),
    });
    assert.equal(decision.ok, false);
  }
});

test("a missing Turnstile secret is skipped in development and refused in production", async () => {
  const skipped = await verifyTurnstile({
    secret: undefined,
    token: undefined,
    expectedAction: "demo",
    expectedHostnames: ["localhost"],
    environment: "development",
    fetchImpl: async () => {
      throw new Error("should not call siteverify");
    },
  });
  assert.deepEqual(skipped, { ok: true, skipped: true });

  const refused = await verifyTurnstile({
    secret: "  ",
    token: "token",
    expectedAction: "demo",
    expectedHostnames: ["pickuproster.com"],
    environment: "production",
  });
  assert.deepEqual(refused, { ok: false, error: "turnstile" });
});

test("Turnstile fails closed when siteverify errors", async () => {
  const decision = await verifyTurnstile({
    secret: "secret",
    token: "token",
    expectedAction: "intro",
    expectedHostnames: ["pickuproster.com"],
    environment: "staging",
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.deepEqual(decision, { ok: false, error: "turnstile" });
});
