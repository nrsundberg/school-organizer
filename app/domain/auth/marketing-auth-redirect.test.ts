import test from "node:test";
import assert from "node:assert/strict";
import {
  authPageRedirectTarget,
  isCreateSchoolStep,
  onboardingSignupPath,
  safeSameSiteTarget,
  signedInHome,
} from "./marketing-auth-redirect";

const ROOT = "pickuproster.com";
const APEX = "https://pickuproster.com";

function target(overrides: Partial<Parameters<typeof authPageRedirectTarget>[0]> = {}) {
  return authPageRedirectTarget({
    page: "signup",
    requestUrl: `${APEX}/signup?plan=car-line`,
    home: "onboarding",
    boardUrl: null,
    next: null,
    onboardingPath: "/signup?step=2&plan=car-line",
    marketingOrigin: APEX,
    onMarketingHost: true,
    ...overrides,
  });
}

test("a missing next param is not a redirect by itself", () => {
  assert.equal(safeSameSiteTarget(null, `${APEX}/signup`, ROOT), null);
  assert.equal(safeSameSiteTarget("   ", `${APEX}/signup`, ROOT), null);
});

test("platform staff go to /platform", () => {
  assert.equal(
    signedInHome({ orgId: "org_1", districtId: null }, { isPlatformStaff: true, hasBoard: true }),
    "platform",
  );
  assert.equal(target({ home: "platform", page: "login", requestUrl: `${APEX}/login` }), "/platform");
  assert.equal(
    target({ home: "platform", page: "signup", requestUrl: `${APEX}/signup?plan=campus` }),
    "/platform",
  );
});

test("a school user goes to that school's board", () => {
  const board = "https://maple.pickuproster.com/";
  assert.equal(
    signedInHome({ orgId: "org_maple" }, { isPlatformStaff: false, hasBoard: true }),
    "board",
  );
  assert.equal(
    target({
      home: "board",
      boardUrl: board,
      page: "signup",
      requestUrl: `${APEX}/signup?plan=car-line`,
    }),
    board,
  );
  assert.equal(
    target({ home: "board", boardUrl: board, page: "login", requestUrl: `${APEX}/login` }),
    board,
  );
});

test("an impersonating district session uses the active school when a board URL is supplied", () => {
  assert.equal(
    signedInHome({ orgId: null, districtId: "dist_1" }, { isPlatformStaff: false, hasBoard: true }),
    "board",
  );
});

test("a district admin with no active school goes to /district", () => {
  assert.equal(
    signedInHome({ orgId: null, districtId: "dist_1" }, { isPlatformStaff: false, hasBoard: false }),
    "district",
  );
  assert.equal(
    target({ home: "district", page: "login", requestUrl: `${APEX}/login` }),
    "/district",
  );
});

test("a signed-in user with no org is sent to the create-school step", () => {
  assert.equal(
    signedInHome({ orgId: null, districtId: null }, { isPlatformStaff: false, hasBoard: false }),
    "onboarding",
  );
  assert.equal(
    onboardingSignupPath(`${APEX}/signup?plan=car-line&cycle=annual`),
    "/signup?step=2&plan=car-line&cycle=annual",
  );
  assert.equal(onboardingSignupPath(`${APEX}/signup?plan=district`), "/signup?step=2");
  assert.equal(
    target({
      home: "onboarding",
      page: "signup",
      requestUrl: `${APEX}/signup?plan=car-line`,
      onboardingPath: "/signup?step=2&plan=car-line",
    }),
    "/signup?step=2&plan=car-line",
  );
  assert.equal(
    target({
      home: "onboarding",
      page: "login",
      requestUrl: `${APEX}/login`,
      onboardingPath: "/signup?step=2",
    }),
    "/signup?step=2",
  );
  assert.equal(isCreateSchoolStep(`${APEX}/signup?step=2&plan=car-line`), true);
  assert.equal(
    target({
      home: "onboarding",
      page: "signup",
      requestUrl: `${APEX}/signup?step=2&plan=car-line`,
      onboardingPath: "/signup?step=2&plan=car-line",
    }),
    null,
  );
  assert.equal(
    target({
      home: "onboarding",
      page: "signup",
      requestUrl: `${APEX}/signup?step=3&plan=campus`,
      onboardingPath: "/signup?step=2&plan=campus",
    }),
    null,
  );
});

test("same-site next is kept and off-site next is dropped", () => {
  const board = "https://maple.pickuproster.com/";
  assert.equal(
    safeSameSiteTarget("/admin/billing", `${APEX}/login`, ROOT),
    "/admin/billing",
  );
  assert.equal(
    safeSameSiteTarget("https://maple.pickuproster.com/admin", `${APEX}/login`, ROOT),
    "https://maple.pickuproster.com/admin",
  );
  assert.equal(
    safeSameSiteTarget("https://www.pickuproster.com/pricing", `${APEX}/login`, ROOT),
    "https://www.pickuproster.com/pricing",
  );
  for (const bad of [
    "https://evil.example/phish",
    "//evil.example",
    "https://pickuproster.com.evil.example/",
    "https://evil.example/?next=https://pickuproster.com",
    "javascript:alert(1)",
    "https://user:pass@pickuproster.com/",
    "/\\evil.example",
    "/login",
    "/signup?plan=car-line",
    "/signup?step=2",
    "/%2F%2Fevil.example",
  ]) {
    assert.equal(safeSameSiteTarget(bad, `${APEX}/login`, ROOT), null, bad);
  }
  assert.equal(
    target({
      home: "board",
      boardUrl: board,
      page: "login",
      requestUrl: `${APEX}/login?next=%2Fadmin%2Fbilling`,
      next: "/admin/billing",
    }),
    "/admin/billing",
  );
  assert.equal(
    target({
      home: "platform",
      page: "login",
      requestUrl: `${APEX}/login?next=https://evil.example`,
      next: null,
    }),
    "/platform",
  );
});

test("auth redirects do not target the page the visitor is already on", () => {
  assert.equal(
    target({
      home: "platform",
      page: "login",
      requestUrl: `${APEX}/platform`,
      onboardingPath: "/signup?step=2",
    }),
    null,
  );
});
