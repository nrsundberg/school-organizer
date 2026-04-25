import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSchoolFilter } from "./district-scope.server";

describe("buildSchoolFilter", () => {
  it("scopes by districtId on the org relation", () => {
    const filter = buildSchoolFilter("dist-123");
    assert.deepEqual(filter, { org: { districtId: "dist-123" } });
  });
  it("can be combined with a base where clause", () => {
    const base = { status: { not: "EMPTY" } };
    const combined = { ...base, ...buildSchoolFilter("dist-123") };
    assert.deepEqual(combined, {
      status: { not: "EMPTY" },
      org: { districtId: "dist-123" },
    });
  });
});
