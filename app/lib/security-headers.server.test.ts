import test from "node:test";
import assert from "node:assert/strict";
import {
  applySecurityHeaders,
  __INTERNAL__,
} from "./security-headers.server";

function makeResponse(init?: ResponseInit, body: BodyInit | null = "ok") {
  return new Response(body, init);
}

test("applies the baseline static headers in production", () => {
  const res = applySecurityHeaders(makeResponse(), { ENVIRONMENT: "production" });

  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    res.headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(
    res.headers.get("Permissions-Policy"),
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")',
  );
});

test("sets Strict-Transport-Security in production", () => {
  const res = applySecurityHeaders(makeResponse(), { ENVIRONMENT: "production" });
  assert.equal(
    res.headers.get("Strict-Transport-Security"),
    __INTERNAL__.HSTS_VALUE,
  );
});

test("omits Strict-Transport-Security in development", () => {
  const res = applySecurityHeaders(makeResponse(), {
    ENVIRONMENT: "development",
  });
  assert.equal(res.headers.get("Strict-Transport-Security"), null);
});

test("sets Strict-Transport-Security when ENVIRONMENT is undefined (defaults to prod)", () => {
  // workers/app.ts treats any non-"development" value, including undefined,
  // as production. Headers mirror that: HSTS ships by default.
  const res = applySecurityHeaders(makeResponse(), {});
  assert.equal(
    res.headers.get("Strict-Transport-Security"),
    __INTERNAL__.HSTS_VALUE,
  );
});

test("ships enforcing CSP and Report-Only CSP side by side", () => {
  const res = applySecurityHeaders(makeResponse(), { ENVIRONMENT: "production" });
  assert.equal(
    res.headers.get("Content-Security-Policy"),
    __INTERNAL__.ENFORCING_CSP,
  );
  assert.equal(
    res.headers.get("Content-Security-Policy-Report-Only"),
    __INTERNAL__.REPORT_ONLY_CSP,
  );
});

test("enforcing CSP contains the critical directives", () => {
  const csp = __INTERNAL__.ENFORCING_CSP;
  assert.ok(csp.includes("default-src 'self'"), "default-src missing");
  assert.ok(csp.includes("frame-ancestors 'none'"), "frame-ancestors missing");
  assert.ok(csp.includes("object-src 'none'"), "object-src missing");
  assert.ok(
    csp.includes("upgrade-insecure-requests"),
    "upgrade-insecure-requests missing",
  );
  assert.ok(
    !csp.includes("script-src"),
    "script-src must not be in enforcing CSP (ships Report-Only)",
  );
  assert.ok(!csp.includes("'unsafe-eval'"), "unsafe-eval forbidden");
  // 'unsafe-inline' in enforcing would only be legal on style-src — we
  // ship that Report-Only, so neither bucket should see it here.
  assert.ok(
    !csp.includes("'unsafe-inline'"),
    "'unsafe-inline' must not appear in enforcing CSP",
  );
});

test("Report-Only CSP does NOT use 'unsafe-eval'", () => {
  const csp = __INTERNAL__.REPORT_ONLY_CSP;
  assert.ok(!csp.includes("'unsafe-eval'"), "unsafe-eval forbidden anywhere");
  assert.ok(csp.includes("script-src"), "script-src should be Report-Only");
  assert.ok(csp.includes("style-src"), "style-src should be Report-Only");
});

test("does not overwrite a Content-Type the handler already set", () => {
  const res = applySecurityHeaders(
    makeResponse({ headers: { "Content-Type": "application/json" } }),
    { ENVIRONMENT: "production" },
  );
  assert.equal(res.headers.get("Content-Type"), "application/json");
});

test("does not overwrite a CSP the handler already set", () => {
  const custom = "default-src 'self' https://example.test";
  const res = applySecurityHeaders(
    makeResponse({ headers: { "Content-Security-Policy": custom } }),
    { ENVIRONMENT: "production" },
  );
  assert.equal(res.headers.get("Content-Security-Policy"), custom);
});

test("does not overwrite a handler-set X-Frame-Options", () => {
  // A handler that intentionally wants to allow framing (none today, but
  // it's the contract) should not be stomped by the defaults.
  const res = applySecurityHeaders(
    makeResponse({ headers: { "X-Frame-Options": "SAMEORIGIN" } }),
    { ENVIRONMENT: "production" },
  );
  assert.equal(res.headers.get("X-Frame-Options"), "SAMEORIGIN");
});

test("preserves status, statusText, and body", async () => {
  const res = applySecurityHeaders(
    new Response("hello world", { status: 418, statusText: "I'm a teapot" }),
    { ENVIRONMENT: "production" },
  );
  assert.equal(res.status, 418);
  assert.equal(res.statusText, "I'm a teapot");
  assert.equal(await res.text(), "hello world");
});

test("passes through a null body (e.g. 304 / redirects)", () => {
  const res = applySecurityHeaders(
    new Response(null, { status: 302, headers: { Location: "/login" } }),
    { ENVIRONMENT: "production" },
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/login");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
});

test("returns a new Response instance (no mutation of input headers)", () => {
  const input = makeResponse();
  const snapshot = [...input.headers.entries()];
  applySecurityHeaders(input, { ENVIRONMENT: "production" });
  assert.deepEqual([...input.headers.entries()], snapshot);
});
