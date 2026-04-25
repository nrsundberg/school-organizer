import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISTRICT_AUDIT_ACTIONS } from "./audit.server";

describe("DISTRICT_AUDIT_ACTIONS", () => {
  it("includes the documented actions", () => {
    const required = [
      "district.admin.invited",
      "district.admin.removed",
      "district.school.created",
      "district.school.cap.exceeded",
      "district.impersonate.start",
      "district.impersonate.end",
      "district.billing.note.changed",
      "district.schoolCap.changed",
      "district.trialEndsAt.changed",
      "district.comp.changed",
    ];
    for (const action of required) {
      assert.ok(
        (DISTRICT_AUDIT_ACTIONS as readonly string[]).includes(action),
        `missing action: ${action}`,
      );
    }
  });
});
