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

test("marketing videos are public and skip tenant and billing gates", () => {
  for (const path of [
    "/marketing/videos/getting-started.mp4",
    "/marketing/videos/car-line-pickups.mp4",
    "/marketing/videos/fire-drills-safety.mp4",
  ]) {
    for (const classify of [marketing, tenant]) {
      const result = classify(path);
      assert.equal(result.isMarketingVideo, true, path);
      assert.equal(result.isPublicMarketingPath, true, path);
      assert.equal(result.anonSkipsViewer, true, path);
      assert.equal(result.skipTenantOrgBinding, true, path);
      assert.equal(result.exemptFromBillingGate, true, path);
    }
  }
  assert.equal(marketing("/pricing").isMarketingVideo, false);
  assert.equal(tenant("/marketing/videos").isMarketingVideo, false);
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

test("demo and the pickup-board page are public only on the marketing host", () => {
  assert.equal(marketing("/demo").isPublicMarketingPath, true);
  assert.equal(tenant("/demo").isPublicMarketingPath, false);
  assert.equal(marketing("/school-pickup-board").isPublicMarketingPath, true);
  assert.equal(tenant("/school-pickup-board").isPublicMarketingPath, false);
  assert.equal(marketing("/demo").anonSkipsViewer, true);
  assert.equal(marketing("/book/intro").isPublicMarketingPath, true);
  assert.equal(tenant("/book/intro").isPublicMarketingPath, false);
  assert.equal(marketing("/book/manage").isPublicMarketingPath, true);
  assert.equal(tenant("/book/manage").isPublicMarketingPath, false);
  assert.equal(marketing("/compare/pikmykid-alternatives").isPublicMarketingPath, true);
  assert.equal(tenant("/compare/pikmykid-alternatives").isPublicMarketingPath, false);
  assert.equal(marketing("/compare/schoolpass-vs-pickuproster").isPublicMarketingPath, true);
  assert.equal(tenant("/compare/schoolpass-vs-pickuproster").isPublicMarketingPath, false);
});

test("robots and sitemap are public on every host and skip tenant gates", () => {
  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    for (const classify of [marketing, tenant]) {
      const result = classify(path);
      assert.equal(result.isPublicMarketingPath, true, path);
      assert.equal(result.anonSkipsViewer, true, path);
      assert.equal(result.skipTenantOrgBinding, true, path);
      assert.equal(result.exemptFromBillingGate, true, path);
    }
  }
});

test("/accept-invite is anonymous-skippable (anon users can open invite links)", () => {
  assert.equal(
    marketing("/accept-invite").anonSkipsViewer,
    true,
    "marketing host: anon visitor must reach /accept-invite",
  );
  assert.equal(
    tenant("/accept-invite").anonSkipsViewer,
    true,
    "tenant host: same rule (belt-and-suspenders)",
  );
});
