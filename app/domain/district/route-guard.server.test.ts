import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDistrictGuardOutcome } from "./route-guard.server";

describe("resolveDistrictGuardOutcome", () => {
  it("redirects to /login when no user", () => {
    const r = resolveDistrictGuardOutcome(null);
    assert.deepEqual(r, { kind: "redirect", to: "/login" });
  });

  it("redirects to /admin for school admins", () => {
    const r = resolveDistrictGuardOutcome({
      orgId: "o1",
      districtId: null,
      isPlatformAdmin: false,
    });
    assert.deepEqual(r, { kind: "redirect", to: "/admin" });
  });

  it("allows platform admins through", () => {
    const r = resolveDistrictGuardOutcome({
      orgId: null,
      districtId: null,
      isPlatformAdmin: true,
    });
    assert.equal(r.kind, "allow-platform");
  });

  it("allows district admins through with their districtId", () => {
    const r = resolveDistrictGuardOutcome({
      orgId: null,
      districtId: "d1",
      isPlatformAdmin: false,
    });
    assert.deepEqual(r, { kind: "allow-district", districtId: "d1" });
  });

  it("redirects unassigned users to /login", () => {
    const r = resolveDistrictGuardOutcome({
      orgId: null,
      districtId: null,
      isPlatformAdmin: false,
    });
    assert.deepEqual(r, { kind: "redirect", to: "/login" });
  });
});
