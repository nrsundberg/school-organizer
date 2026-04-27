// Tests for cloneGlobalTemplateToOrg + fanOutClassRollWithTeachers.
//
// Same approach as live.server.test.ts: hand-rolled FakePrisma that mocks
// only the Prisma calls clone.server.ts touches (`teacher.findMany` +
// `drillTemplate.create`). No SQLite, no migrations.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getGlobalTemplate } from "./library";
import type { TemplateDefinition } from "./types";

interface FakeTeacherRow {
  id: number;
  orgId: string;
  homeRoom: string;
}

interface FakeDrillTemplateRow {
  id: string;
  orgId: string;
  name: string;
  drillType: string;
  authority: string;
  instructions: string;
  globalKey: string | null;
  definition: object;
}

class FakePrisma {
  private teachers: FakeTeacherRow[] = [];
  private templates: FakeDrillTemplateRow[] = [];
  private templateIdCounter = 1;

  seedTeachers(rows: FakeTeacherRow[]) {
    this.teachers.push(...rows);
  }

  teacher = {
    findMany: async (args: {
      where?: { orgId?: string };
      select?: Record<string, true>;
      orderBy?: { homeRoom?: "asc" | "desc" };
    }): Promise<{ id: number; homeRoom: string }[]> => {
      const orgId = args.where?.orgId;
      let rows = this.teachers.filter(
        (t) => orgId === undefined || t.orgId === orgId,
      );
      if (args.orderBy?.homeRoom === "asc") {
        rows = [...rows].sort((a, b) => a.homeRoom.localeCompare(b.homeRoom));
      } else if (args.orderBy?.homeRoom === "desc") {
        rows = [...rows].sort((a, b) => b.homeRoom.localeCompare(a.homeRoom));
      }
      return rows.map((r) => ({ id: r.id, homeRoom: r.homeRoom }));
    },
  };

  drillTemplate = {
    create: async (args: {
      data: {
        orgId: string;
        name: string;
        drillType: string;
        authority: string;
        instructions: string;
        globalKey: string;
        definition: object;
      };
    }): Promise<FakeDrillTemplateRow> => {
      const row: FakeDrillTemplateRow = {
        id: `tpl-${this.templateIdCounter++}`,
        orgId: args.data.orgId,
        name: args.data.name,
        drillType: args.data.drillType,
        authority: args.data.authority,
        instructions: args.data.instructions,
        globalKey: args.data.globalKey,
        definition: args.data.definition,
      };
      this.templates.push(row);
      return row;
    },
  };

  _templates(): FakeDrillTemplateRow[] {
    return [...this.templates];
  }
}

// Try to import — same pattern as live.server.test so a missing schema
// doesn't break the rest of the test run.
type CloneModule = typeof import("./clone.server");
let mod: CloneModule | null = null;
let importError: unknown = null;
try {
  mod = await import("./clone.server");
} catch (err) {
  importError = err;
}

function P(p: FakePrisma): Parameters<CloneModule["cloneGlobalTemplateToOrg"]>[0] {
  return p as unknown as Parameters<CloneModule["cloneGlobalTemplateToOrg"]>[0];
}

const ORG = "org-test";

if (!mod) {
  describe("clone.server — SKIPPED", () => {
    it("could not import clone.server.ts", { skip: true }, () => {
      console.error("clone.server import failed:", importError);
    });
  });
} else {
  const { cloneGlobalTemplateToOrg, fanOutClassRollWithTeachers } = mod;

  // -------------------------------------------------------------------------
  // Direct unit tests for the pure fan-out helper.
  // -------------------------------------------------------------------------
  describe("fanOutClassRollWithTeachers", () => {
    it("zero teachers → returns the definition unchanged", () => {
      const def = getGlobalTemplate("fire-evacuation")!.definition;
      const out = fanOutClassRollWithTeachers(def, []);
      assert.equal(out.rows.length, def.rows.length);
      assert.deepEqual(out.rows, def.rows);
    });

    it("no Teacher column → returns the definition unchanged", () => {
      const def: TemplateDefinition = {
        columns: [
          { id: "area", label: "Area", kind: "text" },
          { id: "ok", label: "OK", kind: "toggle" },
        ],
        rows: [{ id: "r1", cells: { area: "Lobby" } }],
      };
      const out = fanOutClassRollWithTeachers(def, [
        { id: 1, homeRoom: "Smith" },
      ]);
      assert.deepEqual(out.rows, def.rows);
    });
  });

  // -------------------------------------------------------------------------
  // Integration-ish tests via cloneGlobalTemplateToOrg.
  // -------------------------------------------------------------------------
  describe("cloneGlobalTemplateToOrg — fire-evacuation (single section)", () => {
    it("fans out to one row per teacher with teacher cell filled", async () => {
      const fake = new FakePrisma();
      fake.seedTeachers([
        { id: 1, orgId: ORG, homeRoom: "Smith - K" },
        { id: 2, orgId: ORG, homeRoom: "Jones 3" },
        { id: 3, orgId: ORG, homeRoom: "Patel - 5" },
      ]);

      const created = await cloneGlobalTemplateToOrg(P(fake), ORG, "fire-evacuation");
      const def = created.definition as unknown as TemplateDefinition;

      assert.equal(def.rows.length, 3, "expected one row per teacher");

      const teacherCells = def.rows.map((r) => r.cells.teacher);
      assert.deepEqual(teacherCells, ["Jones 3", "Patel - 5", "Smith - K"]);

      // Row ids should be stable + derived from teacher.id.
      const ids = def.rows.map((r) => r.id).sort();
      assert.deepEqual(ids, ["teacher-1", "teacher-2", "teacher-3"]);

      // Grade cells should be derived from homeRoom where possible.
      const gradeCells = def.rows.map((r) => r.cells.grade);
      assert.ok(gradeCells.includes("K"));
      assert.ok(gradeCells.includes("3"));
      assert.ok(gradeCells.includes("5"));

      // Per-row defaults from the prototype row should be preserved.
      assert.ok(
        def.rows.every((r) => r.cells["assembly-point"]?.length > 0),
        "expected assembly-point default to be carried over from prototype row",
      );

      // Columns and other fields untouched.
      assert.equal(def.columns.length, 5);
      assert.equal(created.globalKey, "fire-evacuation");
      assert.equal(created.orgId, ORG);
    });

    it("falls back to library rows when org has zero teachers", async () => {
      const fake = new FakePrisma();
      const created = await cloneGlobalTemplateToOrg(P(fake), ORG, "fire-evacuation");
      const def = created.definition as unknown as TemplateDefinition;
      const source = getGlobalTemplate("fire-evacuation")!.definition;
      // Verbatim — original ids and grade labels preserved.
      assert.deepEqual(
        def.rows.map((r) => r.id),
        source.rows.map((r) => r.id),
      );
      assert.deepEqual(
        def.rows.map((r) => r.cells.grade),
        source.rows.map((r) => r.cells.grade),
      );
    });
  });

  describe("cloneGlobalTemplateToOrg — multi-section templates", () => {
    it("lockdown-srp: only class-roll section is fanned out; staff-actions preserved", async () => {
      const fake = new FakePrisma();
      fake.seedTeachers([
        { id: 10, orgId: ORG, homeRoom: "Mrs. A - K" },
        { id: 11, orgId: ORG, homeRoom: "Mr. B - 1" },
      ]);

      const created = await cloneGlobalTemplateToOrg(P(fake), ORG, "lockdown-srp");
      const def = created.definition as unknown as TemplateDefinition;
      const source = getGlobalTemplate("lockdown-srp")!.definition;

      const staffRows = def.rows.filter((r) => r.sectionId === "staff-actions");
      const rollRows = def.rows.filter((r) => r.sectionId === "class-roll");

      // Staff actions are untouched (same count, same ids, same item text).
      const sourceStaff = source.rows.filter((r) => r.sectionId === "staff-actions");
      assert.equal(staffRows.length, sourceStaff.length);
      assert.deepEqual(
        staffRows.map((r) => r.id),
        sourceStaff.map((r) => r.id),
      );
      assert.deepEqual(
        staffRows.map((r) => r.cells.item),
        sourceStaff.map((r) => r.cells.item),
      );

      // Class-roll rows replaced with one per teacher.
      assert.equal(rollRows.length, 2);
      const teacherCells = rollRows.map((r) => r.cells.teacher).sort();
      assert.deepEqual(teacherCells, ["Mr. B - 1", "Mrs. A - K"]);
      // Each fanned row keeps the section id so it renders under the right
      // heading on the run screen.
      assert.ok(rollRows.every((r) => r.sectionId === "class-roll"));
    });

    it("bus-evacuation: no class-roll section → driver-actions and student-roll untouched", async () => {
      const fake = new FakePrisma();
      fake.seedTeachers([
        { id: 20, orgId: ORG, homeRoom: "Smith - K" },
        { id: 21, orgId: ORG, homeRoom: "Jones - 1" },
      ]);

      const created = await cloneGlobalTemplateToOrg(P(fake), ORG, "bus-evacuation");
      const def = created.definition as unknown as TemplateDefinition;
      const source = getGlobalTemplate("bus-evacuation")!.definition;

      // Bus-evacuation has no Teacher column AND no class-roll section, so
      // the template should round-trip untouched.
      assert.deepEqual(
        def.rows.map((r) => r.id),
        source.rows.map((r) => r.id),
      );
      assert.deepEqual(
        def.rows.map((r) => r.sectionId),
        source.rows.map((r) => r.sectionId),
      );
    });
  });

  describe("cloneGlobalTemplateToOrg — orgId scoping", () => {
    it("only includes teachers from the requested org", async () => {
      const fake = new FakePrisma();
      fake.seedTeachers([
        { id: 1, orgId: ORG, homeRoom: "Smith - K" },
        { id: 2, orgId: "other-org", homeRoom: "OtherOrg Teacher" },
      ]);
      const created = await cloneGlobalTemplateToOrg(P(fake), ORG, "fire-evacuation");
      const def = created.definition as unknown as TemplateDefinition;
      assert.equal(def.rows.length, 1);
      assert.equal(def.rows[0].cells.teacher, "Smith - K");
    });
  });

  describe("cloneGlobalTemplateToOrg — bad input", () => {
    it("throws 404 Response for unknown globalKey", async () => {
      const fake = new FakePrisma();
      try {
        await cloneGlobalTemplateToOrg(P(fake), ORG, "no-such-template");
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof Response);
        assert.equal((err as Response).status, 404);
      }
    });
  });
}
