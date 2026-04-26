import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateScopeAndRole } from "./invite-user.server";

describe("validateScopeAndRole", () => {
  it("accepts PLATFORM_ADMIN at platform scope only", () => {
    assert.equal(
      validateScopeAndRole({ kind: "platform" }, "PLATFORM_ADMIN"),
      true,
    );
    assert.equal(
      validateScopeAndRole({ kind: "org", id: "org-1" }, "PLATFORM_ADMIN"),
      false,
    );
    assert.equal(
      validateScopeAndRole(
        { kind: "district", id: "d-1" },
        "PLATFORM_ADMIN",
      ),
      false,
    );
  });

  it("accepts ADMIN/CONTROLLER/VIEWER at org scope only", () => {
    for (const role of ["ADMIN", "CONTROLLER", "VIEWER"]) {
      assert.equal(
        validateScopeAndRole({ kind: "org", id: "org-1" }, role),
        true,
        `org scope should accept ${role}`,
      );
      assert.equal(
        validateScopeAndRole({ kind: "platform" }, role),
        false,
        `platform scope should reject ${role}`,
      );
    }
  });

  it("only accepts ADMIN at district scope", () => {
    assert.equal(
      validateScopeAndRole({ kind: "district", id: "d-1" }, "ADMIN"),
      true,
    );
    assert.equal(
      validateScopeAndRole({ kind: "district", id: "d-1" }, "CONTROLLER"),
      false,
    );
    assert.equal(
      validateScopeAndRole({ kind: "district", id: "d-1" }, "VIEWER"),
      false,
    );
  });

  it("rejects unknown roles regardless of scope", () => {
    assert.equal(
      validateScopeAndRole({ kind: "platform" }, "SUPERUSER"),
      false,
    );
    assert.equal(
      validateScopeAndRole({ kind: "org", id: "o" }, ""),
      false,
    );
  });
});
