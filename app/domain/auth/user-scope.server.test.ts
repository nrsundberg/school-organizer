import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertUserScopeXor, classifyUserScope } from "./user-scope.server";

describe("user-scope XOR invariant", () => {
  it("rejects users with no scope set", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: null, districtId: null, isPlatformAdmin: false }),
      /User must have exactly one of orgId, districtId, or isPlatformAdmin set/,
    );
  });

  it("rejects users with orgId AND districtId", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: "o1", districtId: "d1", isPlatformAdmin: false }),
      /exactly one/,
    );
  });

  it("rejects users with orgId AND isPlatformAdmin", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: "o1", districtId: null, isPlatformAdmin: true }),
      /exactly one/,
    );
  });

  it("rejects users with districtId AND isPlatformAdmin", () => {
    assert.throws(
      () => assertUserScopeXor({ orgId: null, districtId: "d1", isPlatformAdmin: true }),
      /exactly one/,
    );
  });

  it("accepts orgId-only", () => {
    assert.doesNotThrow(() =>
      assertUserScopeXor({ orgId: "o1", districtId: null, isPlatformAdmin: false }),
    );
  });

  it("accepts districtId-only", () => {
    assert.doesNotThrow(() =>
      assertUserScopeXor({ orgId: null, districtId: "d1", isPlatformAdmin: false }),
    );
  });

  it("accepts isPlatformAdmin-only", () => {
    assert.doesNotThrow(() =>
      assertUserScopeXor({ orgId: null, districtId: null, isPlatformAdmin: true }),
    );
  });
});

describe("classifyUserScope", () => {
  it("returns 'school' for orgId users", () => {
    assert.equal(
      classifyUserScope({ orgId: "o1", districtId: null, isPlatformAdmin: false }),
      "school",
    );
  });
  it("returns 'district' for districtId users", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: "d1", isPlatformAdmin: false }),
      "district",
    );
  });
  it("returns 'platform' for platform admins", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: null, isPlatformAdmin: true }),
      "platform",
    );
  });
  it("returns 'unassigned' for users with no scope", () => {
    assert.equal(
      classifyUserScope({ orgId: null, districtId: null, isPlatformAdmin: false }),
      "unassigned",
    );
  });
});
