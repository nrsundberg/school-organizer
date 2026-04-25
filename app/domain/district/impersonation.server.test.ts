import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canImpersonate } from "./impersonation.server";

describe("canImpersonate", () => {
  const baseUser = {
    id: "u1",
    districtId: "d1",
    orgId: null,
    isPlatformAdmin: false,
  };

  it("allows district admin -> school in same district", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: "d1" });
    assert.deepEqual(result, { ok: true });
  });

  it("rejects district admin -> school in different district", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: "d2" });
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; reason: string }).reason,
      /different district/,
    );
  });

  it("rejects district admin -> standalone school", () => {
    const result = canImpersonate(baseUser, { id: "o1", districtId: null });
    assert.equal(result.ok, false);
  });

  it("rejects non-district-admin", () => {
    const user = {
      id: "u1",
      districtId: null,
      orgId: "o1",
      isPlatformAdmin: false,
    };
    const result = canImpersonate(user, { id: "o2", districtId: "d1" });
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; reason: string }).reason,
      /not a district admin/,
    );
  });
});
