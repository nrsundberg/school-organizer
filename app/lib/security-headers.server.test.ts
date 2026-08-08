import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, __INTERNAL__ } from "./security-headers.server";

function makeResponse(init?: ResponseInit, body: BodyInit | null = "ok") {
  return new Response(body, init);
}

const TEST_NONCE = "test-nonce";

test("applies the baseline static headers in production", () => {
  const res = applySecurityHeaders(
    makeResponse(),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );

  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    res.headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin"
  );
  assert.equal(
    res.headers.get("Permissions-Policy"),
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")'
  );
});

test("sets Strict-Transport-Security in production", () => {
  const res = applySecurityHeaders(
    makeResponse(),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(
    res.headers.get("Strict-Transport-Security"),
    __INTERNAL__.HSTS_VALUE
  );
});

test("omits Strict-Transport-Security in development", () => {
  const res = applySecurityHeaders(
    makeResponse(),
    {
      ENVIRONMENT: "development"
    },
    TEST_NONCE
  );
  assert.equal(res.headers.get("Strict-Transport-Security"), null);
});

test("sets Strict-Transport-Security when ENVIRONMENT is undefined (defaults to prod)", () => {
  // workers/app.ts treats any non-"development" value, including undefined,
  // as production. Headers mirror that: HSTS ships by default.
  const res = applySecurityHeaders(makeResponse(), {}, TEST_NONCE);
  assert.equal(
    res.headers.get("Strict-Transport-Security"),
    __INTERNAL__.HSTS_VALUE
  );
});

test("ships enforcing CSP with the request nonce", () => {
  const res = applySecurityHeaders(
    makeResponse(),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(
    res.headers.get("Content-Security-Policy"),
    __INTERNAL__.buildEnforcingCsp(TEST_NONCE, false)
  );
});

test("enforcing CSP contains the critical directives", () => {
  const csp = __INTERNAL__.buildEnforcingCsp(TEST_NONCE, false);
  assert.ok(csp.includes("default-src 'self'"), "default-src missing");
  assert.ok(csp.includes("script-src"), "script-src missing");
  assert.ok(
    csp.includes(`'nonce-${TEST_NONCE}'`),
    "script nonce missing from script-src"
  );
  assert.ok(
    csp.includes("style-src 'self' 'unsafe-inline'"),
    "style-src missing"
  );
  assert.ok(csp.includes("frame-ancestors 'none'"), "frame-ancestors missing");
  assert.ok(csp.includes("object-src 'none'"), "object-src missing");
  assert.ok(
    csp.includes("upgrade-insecure-requests"),
    "upgrade-insecure-requests missing in production"
  );
  assert.ok(!csp.includes("'unsafe-eval'"), "unsafe-eval forbidden");
  assert.ok(
    !csp.includes("script-src 'self' 'unsafe-inline'"),
    "script-src must not allow unsafe-inline"
  );
});

// `upgrade-insecure-requests` breaks WebKit on plain-HTTP localhost — it
// upgrades subresource fetches to https://, the wrangler dev server has no
// TLS, and the JS bundle silently fails with a TLS error. Hydration never
// runs and i18n keys stay literal. Chrome quietly skips the upgrade because
// it treats http://localhost as a secure context, so the bug only surfaces
// on the WebKit Playwright shard.
test("development CSP omits upgrade-insecure-requests", () => {
  const csp = __INTERNAL__.buildEnforcingCsp(TEST_NONCE, true);
  assert.ok(
    !csp.includes("upgrade-insecure-requests"),
    "upgrade-insecure-requests must not be present in dev CSP"
  );
  // Sanity-check the rest of the policy still ships in dev — we only want
  // to drop the one directive that breaks WebKit on http://localhost.
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes(`'nonce-${TEST_NONCE}'`));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});

test("development environment omits upgrade-insecure-requests on the response CSP", () => {
  const res = applySecurityHeaders(
    makeResponse(),
    { ENVIRONMENT: "development" },
    TEST_NONCE
  );
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  assert.ok(
    !csp.includes("upgrade-insecure-requests"),
    "dev response must not include upgrade-insecure-requests"
  );
});

test("does not overwrite a Content-Type the handler already set", () => {
  const res = applySecurityHeaders(
    makeResponse({ headers: { "Content-Type": "application/json" } }),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(res.headers.get("Content-Type"), "application/json");
});

test("does not overwrite a CSP the handler already set", () => {
  const custom = "default-src 'self' https://example.test";
  const res = applySecurityHeaders(
    makeResponse({ headers: { "Content-Security-Policy": custom } }),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(res.headers.get("Content-Security-Policy"), custom);
});

test("does not overwrite a handler-set X-Frame-Options", () => {
  // A handler that intentionally wants to allow framing (none today, but
  // it's the contract) should not be stomped by the defaults.
  const res = applySecurityHeaders(
    makeResponse({ headers: { "X-Frame-Options": "SAMEORIGIN" } }),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(res.headers.get("X-Frame-Options"), "SAMEORIGIN");
});

test("preserves status, statusText, and body", async () => {
  const res = applySecurityHeaders(
    new Response("hello world", { status: 418, statusText: "I'm a teapot" }),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(res.status, 418);
  assert.equal(res.statusText, "I'm a teapot");
  assert.equal(await res.text(), "hello world");
});

test("passes through a null body (e.g. 304 / redirects)", () => {
  const res = applySecurityHeaders(
    new Response(null, { status: 302, headers: { Location: "/login" } }),
    { ENVIRONMENT: "production" },
    TEST_NONCE
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/login");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
});

test("returns a new Response instance (no mutation of input headers)", () => {
  const input = makeResponse();
  const snapshot = [...input.headers.entries()];
  applySecurityHeaders(input, { ENVIRONMENT: "production" }, TEST_NONCE);
  assert.deepEqual([...input.headers.entries()], snapshot);
});

// Regression: marketing home renders <iframe src="https://www.youtube-nocookie.com/embed/...">
// in `MarketingLanding.tsx`. Without the YouTube hosts in `frame-src`, the
// browser refuses to frame the explainer video and logs a CSP violation.
// Both the privacy-enhanced host and the canonical `www.youtube.com` host
// are allowed because YouTube's player can fall back / redirect between them.
test("frame-src allows YouTube embed hosts for the marketing explainer", () => {
  const csp = __INTERNAL__.buildEnforcingCsp(TEST_NONCE, false);
  const frameSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("frame-src "));
  assert.ok(frameSrc, "frame-src directive missing entirely");
  assert.ok(
    frameSrc!.includes("https://www.youtube-nocookie.com"),
    `frame-src must include youtube-nocookie.com — got: ${frameSrc}`
  );
  assert.ok(
    frameSrc!.includes("https://www.youtube.com"),
    `frame-src must include youtube.com — got: ${frameSrc}`
  );
  // Stripe entries must still be present — fix should be additive, not a swap.
  assert.ok(frameSrc!.includes("https://js.stripe.com"));
  assert.ok(frameSrc!.includes("https://checkout.stripe.com"));
  assert.ok(frameSrc!.includes("https://billing.stripe.com"));
});
