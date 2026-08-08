import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTeacherImport,
  applyTeacherMapping,
  buildTeacherImportPlan,
  suggestTeacherMapping,
  type InviteTeacherFn,
  type TeacherImportRow,
  type TeacherPlanPrisma,
  type TeacherWritePrisma,
} from "./teacher-import.server";
import type { SpreadsheetGrid } from "~/domain/csv/spreadsheet.server";

test("suggestTeacherMapping: detects name/email/homeRoom/role aliases", () => {
  const mapping = suggestTeacherMapping([
    "Teacher Name",
    "Work Email",
    "Classroom",
    "Access Level",
  ]);
  assert.deepEqual(mapping, { name: 0, email: 1, homeRoom: 2, role: 3 });
});

test("applyTeacherMapping: validates email, dedupes, resolves role default", () => {
  const grid: SpreadsheetGrid = {
    header: ["Name", "Email", "Class", "Role"],
    rows: [
      ["Ada Lovelace", "Ada@School.org", "Room 101", "controller"],
      ["Grace Hopper", "grace@school.org", "Room 102", ""], // default role
      ["Bad Row", "not-an-email", "Room 103", ""], // invalid email
      ["Dup", "ada@school.org", "Room 104", ""], // duplicate email
    ],
  };
  const mapping = suggestTeacherMapping(grid.header);
  const result = applyTeacherMapping(grid, mapping, "VIEWER");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    rowNumber: 2,
    name: "Ada Lovelace",
    email: "ada@school.org", // lowercased
    homeRoom: "Room 101",
    role: "CONTROLLER",
  });
  assert.equal(result.rows[1].role, "VIEWER", "blank role falls back to default");

  const keys = result.rowErrors.map((e) => e.message.key);
  assert.ok(keys.includes("errors:teacherImport.emailInvalid"));
  assert.ok(keys.includes("errors:teacherImport.duplicateEmail"));
});

test("applyTeacherMapping: missing required column returns missingColumns", () => {
  const grid: SpreadsheetGrid = { header: ["Name", "Class"], rows: [] };
  const result = applyTeacherMapping(
    grid,
    { name: 0, email: null, homeRoom: 1, role: null },
    "VIEWER",
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.key, "errors:teacherImport.missingColumns");
});

function rows(): TeacherImportRow[] {
  return [
    { rowNumber: 2, name: "Ada Lovelace", email: "ada@s.org", homeRoom: "Room 101", role: "VIEWER" },
    { rowNumber: 3, name: "Grace Hopper", email: "grace@s.org", homeRoom: "Room 101", role: "VIEWER" },
    { rowNumber: 4, name: "Alan Turing", email: "alan@s.org", homeRoom: "Room 202", role: "CONTROLLER" },
  ];
}

test("buildTeacherImportPlan: classifies existing users + new homerooms", async () => {
  const prisma: TeacherPlanPrisma = {
    user: { findMany: async () => [{ email: "grace@s.org" }] }, // grace already exists
    teacher: { findMany: async () => [{ homeRoom: "Room 101" }] }, // 101 exists
  };
  const plan = await buildTeacherImportPlan(prisma, rows());

  assert.equal(plan.summary.total, 3);
  assert.equal(plan.summary.inviteCount, 2, "ada + alan invited, grace existing");
  assert.equal(plan.summary.existingCount, 1);
  assert.deepEqual(plan.newHomerooms, ["Room 202"], "only 202 is new");
  assert.equal(plan.rows.find((r) => r.email === "grace@s.org")?.status, "existing");
});

test("applyTeacherImport: creates new homerooms, updates existing, tallies outcomes", async () => {
  const created: string[] = [];
  const updated: string[] = [];
  const prisma: TeacherWritePrisma = {
    teacher: {
      findMany: async () => [{ homeRoom: "Room 101" }], // 101 exists, 202 new
      createMany: async ({ data }) => {
        created.push(...data.map((d) => d.homeRoom));
        return {};
      },
      updateMany: async ({ where }) => {
        updated.push(where.homeRoom);
        return {};
      },
    },
  };
  // grace fails to invite (already a user); others succeed.
  const invite: InviteTeacherFn = async (row) =>
    row.email === "grace@s.org" ? "existing" : "invited";

  const summary = await applyTeacherImport(prisma, rows(), invite);

  assert.deepEqual(created, ["Room 202"], "only the new homeroom is created once");
  assert.deepEqual(updated, ["Room 101"], "existing homeroom updated once (deduped)");
  assert.equal(summary.teachersCreated, 1);
  assert.equal(summary.invited, 2);
  assert.equal(summary.existing, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.outcomes.length, 3);
});

test("applyTeacherImport: a failed invite does not abort the batch", async () => {
  const prisma: TeacherWritePrisma = {
    teacher: {
      findMany: async () => [],
      createMany: async () => ({}),
      updateMany: async () => ({}),
    },
  };
  const invite: InviteTeacherFn = async (row) =>
    row.rowNumber === 3 ? "failed" : "invited";

  const summary = await applyTeacherImport(prisma, rows(), invite);
  assert.equal(summary.failed, 1);
  assert.equal(summary.invited, 2);
  assert.equal(summary.outcomes.length, 3, "all rows attempted");
});
