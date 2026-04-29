import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequestPath } from "./path-classification";

const tenant = (pathname: string) => classifyRequestPath(pathname, false);
const marketing = (pathname: string) => classifyRequestPath(pathname, true);

test("static asset paths are classified as static", () => {
  assert.equal(tenant("/assets/foo.js").isStatic, true);
  assert.equal(tenant("/build/foo.css").isStatic, true);
  assert.equal(tenant("/favicon.ico").isStatic, true);
  assert.equal(tenant("/admin/dashboard").isStatic, false);
});

test("auth-flow paths are anonymous-skippable", () => {
  for (const path of [
    "/login",
    "/logout",
    "/forgot-password",
    "/reset-password",
    "/viewer-access",
    "/api/auth/sign-in",
    "/api/check-email",
    "/api/check-org-slug",
    "/api/branding/logo/abc",
    "/api/healthz",
    "/api/status-probe",
  ]) {
    assert.equal(
      tenant(path).anonSkipsViewer,
      true,
      `expected anonSkipsViewer for ${path}`,
    );
  }
});

test("system bypass paths skip tenant/org binding (auth-api, stripe webhook, static, logout)", () => {
  assert.equal(tenant("/api/auth/anything").skipTenantOrgBinding, true);
  assert.equal(tenant("/api/webhooks/stripe").skipTenantOrgBinding, true);
  assert.equal(tenant("/assets/x.js").skipTenantOrgBinding, true);
  assert.equal(tenant("/logout").skipTenantOrgBinding, true);
  assert.equal(tenant("/admin/dashboard").skipTenantOrgBinding, false);
});

test("billing-related bypass paths exempt the billing gate", () => {
  assert.equal(tenant("/billing-required").exemptFromBillingGate, true);
  assert.equal(tenant("/api/onboarding").exemptFromBillingGate, true);
  assert.equal(tenant("/api/webhooks/stripe").exemptFromBillingGate, true);
  assert.equal(tenant("/api/auth/sign-in").exemptFromBillingGate, true);
  assert.equal(tenant("/assets/x.js").exemptFromBillingGate, true);
  assert.equal(tenant("/admin/dashboard").exemptFromBillingGate, false);
});

test("public marketing paths only count when on the marketing host", () => {
  // Pricing/faqs/status/blog/guides are host-agnostic; signup/root are marketing-only.
  assert.equal(marketing("/pricing").isPublicMarketingPath, true);
  assert.equal(tenant("/pricing").isPublicMarketingPath, true);
  // Signup is public only on marketing host.
  assert.equal(marketing("/signup").isPublicMarketingPath, true);
  assert.equal(tenant("/signup").isPublicMarketingPath, false);
  // Root is public on marketing only.
  assert.equal(marketing("/").isPublicMarketingPath, true);
  assert.equal(tenant("/").isPublicMarketingPath, false);
});

test("/platform routes are flagged for the console-redirect rule", () => {
  assert.equal(tenant("/platform").isPlatform, true);
  assert.equal(tenant("/platform/orgs").isPlatform, true);
  assert.equal(tenant("/admin/dashboard").isPlatform, false);
});

test("set-password is its own bucket (mustChangePassword guard)", () => {
  assert.equal(tenant("/set-password").isSetPassword, true);
  assert.equal(tenant("/admin/dashboard").isSetPassword, false);
});
