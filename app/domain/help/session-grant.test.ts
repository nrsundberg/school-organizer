import test from "node:test";
import assert from "node:assert/strict";
import { authorizeHelpChat } from "./access.server";
import { HELP_SESSION_TTL_MS, TURNSTILE_ACTION_CHAT } from "./limits";
import { signHelpSession, verifyHelpSession } from "./session-grant";
import { verifyTurnstile } from "~/domain/booking/turnstile";

const SECRET = "test-help-session-secret";
const SESSION = "11111111-2222-4333-8444-555555555555";
const NOW = 1_700_000_000_000;

test("help session grant round-trips and rejects tampering, expiry, and other sessions", async () => {
  const token = await signHelpSession({ secret: SECRET, sessionId: SESSION, now: NOW });
  assert.equal(
    await verifyHelpSession({ secret: SECRET, token, sessionId: SESSION, now: NOW + 1000 }),
    true,
  );
  assert.equal(
    await verifyHelpSession({
      secret: SECRET,
      token,
      sessionId: SESSION,
      now: NOW + HELP_SESSION_TTL_MS + 1,
    }),
    false,
  );
  assert.equal(
    await verifyHelpSession({
      secret: SECRET,
      token,
      sessionId: "22222222-2222-4333-8444-555555555555",
      now: NOW + 1000,
    }),
    false,
  );
  const [sid, exp, sig] = token.split(".");
  const flipped = `${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
  assert.equal(
    await verifyHelpSession({
      secret: SECRET,
      token: `${sid}.${exp}.${flipped}`,
      sessionId: SESSION,
      now: NOW + 1000,
    }),
    false,
  );
});

test("chat requires Turnstile until a grant exists, then accepts the grant", async () => {
  let verifies = 0;
  const first = await authorizeHelpChat({
    source: { BETTER_AUTH_SECRET: SECRET, ENVIRONMENT: "staging" },
    sessionId: SESSION,
    grant: "",
    turnstileToken: "",
    turnstileRequired: true,
    now: NOW,
    verify: async () => {
      verifies += 1;
      return { ok: false, error: "turnstile" };
    },
  });
  assert.equal(first.ok, false);
  if (!first.ok) {
    assert.equal(first.status, 403);
    assert.equal(first.code, "challenge");
  }
  assert.equal(verifies, 0);

  const passed = await authorizeHelpChat({
    source: { BETTER_AUTH_SECRET: SECRET, ENVIRONMENT: "staging" },
    sessionId: SESSION,
    grant: "",
    turnstileToken: "token-1",
    turnstileRequired: true,
    now: NOW,
    verify: async (token) => {
      verifies += 1;
      assert.equal(token, "token-1");
      return { ok: true, skipped: false };
    },
  });
  assert.equal(passed.ok, true);
  if (!passed.ok || !passed.grant) throw new Error("expected a grant");

  const again = await authorizeHelpChat({
    source: { BETTER_AUTH_SECRET: SECRET, ENVIRONMENT: "staging" },
    sessionId: SESSION,
    grant: passed.grant,
    turnstileToken: "",
    turnstileRequired: true,
    now: NOW + 1000,
    verify: async () => {
      verifies += 1;
      return { ok: false, error: "turnstile" };
    },
  });
  assert.equal(again.ok, true);
  assert.equal(verifies, 1);
});

test("chat fails closed in staging when Turnstile cannot be checked", async () => {
  const decision = await verifyTurnstile({
    secret: undefined,
    token: "token",
    expectedAction: TURNSTILE_ACTION_CHAT,
    expectedHostnames: ["staging.pickuproster.com"],
    environment: "staging",
    fetchImpl: async () => {
      throw new Error("should not call siteverify");
    },
  });
  assert.deepEqual(decision, { ok: false, error: "turnstile" });
});

test("chat Turnstile checks action and the request hostname", async () => {
  const decision = await verifyTurnstile({
    secret: "secret",
    token: "token",
    expectedAction: TURNSTILE_ACTION_CHAT,
    expectedHostnames: ["riverside.staging.pickuproster.com"],
    environment: "staging",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: true,
          action: "help_chat",
          hostname: "staging.pickuproster.com",
        }),
        { status: 200 },
      ),
  });
  assert.deepEqual(decision, { ok: false, error: "turnstile" });
});
