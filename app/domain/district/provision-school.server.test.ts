import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSchoolProvisioningInput } from "./provision-school.server";

describe("validateSchoolProvisioningInput", () => {
  it("requires school name", () => {
    assert.throws(
      () =>
        validateSchoolProvisioningInput({
          schoolName: "",
          schoolSlug: "abc",
          adminEmail: "a@b.co",
          adminName: "A",
        }),
      /name/i,
    );
  });
  it("requires slug", () => {
    assert.throws(
      () =>
        validateSchoolProvisioningInput({
          schoolName: "X",
          schoolSlug: "",
          adminEmail: "a@b.co",
          adminName: "A",
        }),
      /slug/i,
    );
  });
  it("requires admin email", () => {
    assert.throws(
      () =>
        validateSchoolProvisioningInput({
          schoolName: "X",
          schoolSlug: "x",
          adminEmail: "",
          adminName: "A",
        }),
      /email/i,
    );
  });
  it("requires admin name", () => {
    assert.throws(
      () =>
        validateSchoolProvisioningInput({
          schoolName: "X",
          schoolSlug: "x",
          adminEmail: "a@b.co",
          adminName: "",
        }),
      /name/i,
    );
  });
  it("returns normalized inputs", () => {
    const r = validateSchoolProvisioningInput({
      schoolName: "  X  ",
      schoolSlug: "X-Y",
      adminEmail: "A@B.co",
      adminName: " A ",
    });
    assert.deepEqual(r, {
      schoolName: "X",
      schoolSlug: "x-y",
      adminEmail: "a@b.co",
      adminName: "A",
    });
  });
});
