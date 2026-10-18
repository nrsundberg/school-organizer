import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCHOOL_HIDDEN_AUDIT_ACTIONS,
  schoolAuditLogWhere,
  visibleSchoolAuditLogs,
} from "./school-activity.server";

const NEW_ORG = "org_pickuproster_test_school_delete_me";
const OTHER_ORG = "org_bhs_example";

const rows = [
  {
    id: "own-magic",
    orgId: NEW_ORG,
    action: "viewer.magiclink.created",
    actor: "New Admin",
  },
  {
    id: "other-magic",
    orgId: OTHER_ORG,
    action: "viewer.magiclink.created",
    actor: "Demo Admin (bhs-example)",
  },
  {
    id: "platform-impersonate",
    orgId: NEW_ORG,
    action: "impersonate.start",
    actor: "Noah Sundberg",
  },
  {
    id: "other-impersonate",
    orgId: OTHER_ORG,
    action: "impersonate.start",
    actor: "Noah Sundberg",
  },
  {
    id: "staff-impersonate",
    orgId: NEW_ORG,
    action: "user.impersonate.start",
    actor: "School Admin",
  },
  {
    id: "plan-change",
    orgId: NEW_ORG,
    action: "plan.manual_change",
    actor: "Noah Sundberg",
  },
  {
    id: "own-reset",
    orgId: NEW_ORG,
    action: "settings.board.reset",
    actor: "New Admin",
  },
];

describe("visibleSchoolAuditLogs", () => {
  it("shows a brand-new org only its own school activity", () => {
    const visible = visibleSchoolAuditLogs(NEW_ORG, rows);
    assert.deepEqual(
      visible.map((row) => row.id),
      ["own-magic", "own-reset"],
    );
  });

  it("returns nothing when the org has no activity of its own", () => {
    assert.deepEqual(visibleSchoolAuditLogs("org_brand_new", rows), []);
  });

  it("hides every platform and impersonation action, including on the org's own rows", () => {
    const own = rows.filter((row) => row.orgId === NEW_ORG);
    const visible = visibleSchoolAuditLogs(NEW_ORG, own);
    for (const action of SCHOOL_HIDDEN_AUDIT_ACTIONS) {
      assert.equal(
        visible.some((row) => row.action === action),
        false,
        action,
      );
    }
  });
});

describe("schoolAuditLogWhere", () => {
  it("always scopes the query to the given org and excludes platform actions", () => {
    const where = schoolAuditLogWhere(NEW_ORG);
    const hidden = where.action.notIn as readonly string[];
    assert.equal(where.orgId, NEW_ORG);
    assert.ok(hidden.includes("impersonate.start"));
    assert.equal(hidden.includes("viewer.magiclink.created"), false);
    assert.ok(hidden.includes("comp.set"));
    assert.ok(hidden.includes("branding.custom_domain"));
  });
});
