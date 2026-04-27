import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRILL_AUDIENCES,
  DRILL_AUDIENCE_LABELS,
  DRILL_TYPES,
  DRILL_TYPE_LABELS,
  defaultTemplateDefinition,
  isDrillAudience,
  isDrillRunStatus,
  isDrillType,
  parseDrillAudience,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
} from "./types";
import type { DrillAudience } from "./types";

describe("parseTemplateDefinition", () => {
  it("passes valid columns/rows/sections through", () => {
    const input = {
      columns: [
        { id: "c1", label: "Grade", kind: "text" as const },
        { id: "c2", label: "Done", kind: "toggle" as const },
      ],
      rows: [
        { id: "r1", cells: { c1: "K" }, sectionId: "s1" },
      ],
      sections: [{ id: "s1", label: "Section A" }],
    };
    const out = parseTemplateDefinition(input as object);
    assert.equal(out.columns.length, 2);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].sectionId, "s1");
    assert.deepEqual(out.sections, [{ id: "s1", label: "Section A" }]);
  });

  it("missing sections returns object without sections key", () => {
    const input = {
      columns: [{ id: "c1", label: "Grade", kind: "text" as const }],
      rows: [{ id: "r1", cells: { c1: "K" } }],
    };
    const out = parseTemplateDefinition(input as object);
    assert.equal(out.sections, undefined);
    assert.ok(!("sections" in out));
  });

  it("rows referencing non-existent sectionId drop the sectionId but keep the row", () => {
    const input = {
      columns: [{ id: "c1", label: "Grade", kind: "text" as const }],
      rows: [
        { id: "r1", cells: { c1: "K" }, sectionId: "ghost-section" },
      ],
      sections: [{ id: "real-section", label: "Real" }],
    };
    const out = parseTemplateDefinition(input as object);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].id, "r1");
    assert.equal(out.rows[0].sectionId, undefined);
  });

  it("empty columns returns defaultTemplateDefinition()", () => {
    const out = parseTemplateDefinition({ columns: [], rows: [] } as object);
    const def = defaultTemplateDefinition();
    assert.equal(out.columns.length, def.columns.length);
    // The returned default has a fresh set of UUIDs but should match shape
    assert.equal(out.columns[0].label, "Grade");
    assert.equal(out.columns[2].kind, "toggle");
  });

  it("fills missing text cells with empty string", () => {
    const input = {
      columns: [
        { id: "c1", label: "Grade", kind: "text" as const },
        { id: "c2", label: "Teacher", kind: "text" as const },
        { id: "c3", label: "Done", kind: "toggle" as const },
      ],
      rows: [{ id: "r1", cells: { c1: "K" } }],
    };
    const out = parseTemplateDefinition(input as object);
    assert.equal(out.rows[0].cells.c1, "K");
    assert.equal(out.rows[0].cells.c2, "");
    // Toggle column should NOT be populated as a text cell.
    assert.equal(out.rows[0].cells.c3, undefined);
  });

  it("returns defaultTemplateDefinition() for null", () => {
    const out = parseTemplateDefinition(null);
    assert.equal(out.columns.length, defaultTemplateDefinition().columns.length);
  });

  it("returns defaultTemplateDefinition() for undefined", () => {
    const out = parseTemplateDefinition(undefined as unknown as null);
    assert.equal(out.columns.length, defaultTemplateDefinition().columns.length);
  });

  it("returns defaultTemplateDefinition() for string input", () => {
    const out = parseTemplateDefinition("garbage" as unknown as null);
    assert.equal(out.columns.length, defaultTemplateDefinition().columns.length);
  });

  it("returns defaultTemplateDefinition() for number input", () => {
    const out = parseTemplateDefinition(42 as unknown as null);
    assert.equal(out.columns.length, defaultTemplateDefinition().columns.length);
  });
});

describe("parseRunState", () => {
  it("parses tri-state run state and migrates legacy booleans", () => {
    // Mixed input exercises the full migration matrix:
    //   - true       → "positive" (legacy "checked")
    //   - false      → dropped to blank (legacy "unchecked")
    //   - "positive" → kept as-is
    //   - "negative" → kept as-is
    //   - garbage    → dropped to blank (defensive)
    const input = {
      toggles: {
        "r1:c1": true,
        "r2:c2": false,
        "r3:c3": "positive",
        "r4:c4": "negative",
        "r5:c5": "garbage",
        "r6:c6": 7,
      },
      notes: "some notes",
      actionItems: [
        { id: "a1", text: "Refill water", done: false },
        { id: "a2", text: "Done item", done: true },
      ],
    };
    const out = parseRunState(input as object);
    assert.deepEqual(out.toggles, {
      "r1:c1": "positive",
      "r3:c3": "positive",
      "r4:c4": "negative",
    });
    assert.equal(out.notes, "some notes");
    assert.equal(out.actionItems.length, 2);
    assert.equal(out.actionItems[0].text, "Refill water");
  });

  it("missing fields yields empty defaults", () => {
    const out = parseRunState({} as object);
    assert.deepEqual(out.toggles, {});
    assert.equal(out.notes, "");
    assert.deepEqual(out.actionItems, []);
  });

  it("garbage input → emptyRunState", () => {
    assert.deepEqual(parseRunState(null), { toggles: {}, notes: "", actionItems: [] });
    assert.deepEqual(parseRunState("nope" as unknown as null), {
      toggles: {},
      notes: "",
      actionItems: [],
    });
    assert.deepEqual(parseRunState(7 as unknown as null), {
      toggles: {},
      notes: "",
      actionItems: [],
    });
  });

  it("filters actionItems with the wrong shape", () => {
    const input = {
      actionItems: [
        { id: "a1", text: "Keep me", done: true },
        { text: "no id" }, // missing id → filtered
        null, // → filtered
        { id: 42 }, // id not a string → filtered
        { id: "a2" }, // id only — text/done coerced to defaults
      ],
    };
    const out = parseRunState(input as object);
    assert.equal(out.actionItems.length, 2);
    assert.equal(out.actionItems[0].id, "a1");
    assert.equal(out.actionItems[1].id, "a2");
    assert.equal(out.actionItems[1].text, "");
    assert.equal(out.actionItems[1].done, false);
  });
});

describe("toggleKey", () => {
  it("formats as `${rowId}:${columnId}`", () => {
    assert.equal(toggleKey("row-1", "col-1"), "row-1:col-1");
    assert.equal(toggleKey("", "x"), ":x");
  });
});

describe("isDrillType", () => {
  it("returns true for known drill type", () => {
    assert.equal(isDrillType("FIRE"), true);
    assert.equal(isDrillType("LOCKDOWN"), true);
  });
  it("returns false for unknown drill type", () => {
    assert.equal(isDrillType("BANANA"), false);
    assert.equal(isDrillType(123), false);
    assert.equal(isDrillType(null), false);
    assert.equal(isDrillType(undefined), false);
  });
});

describe("isDrillRunStatus", () => {
  it("returns true for valid statuses", () => {
    assert.equal(isDrillRunStatus("DRAFT"), true);
    assert.equal(isDrillRunStatus("LIVE"), true);
    assert.equal(isDrillRunStatus("PAUSED"), true);
    assert.equal(isDrillRunStatus("ENDED"), true);
  });
  it("returns false for invalid statuses", () => {
    assert.equal(isDrillRunStatus("ACTIVE"), false);
    assert.equal(isDrillRunStatus(""), false);
    assert.equal(isDrillRunStatus(null), false);
    assert.equal(isDrillRunStatus(0), false);
  });
});

describe("DRILL_TYPE_LABELS", () => {
  it("has an entry for every DrillType member", () => {
    for (const dt of DRILL_TYPES) {
      assert.ok(
        DRILL_TYPE_LABELS[dt],
        `DRILL_TYPE_LABELS missing entry for "${dt}"`,
      );
      assert.equal(typeof DRILL_TYPE_LABELS[dt], "string");
    }
    // And it does not have extra junk keys.
    assert.equal(
      Object.keys(DRILL_TYPE_LABELS).length,
      DRILL_TYPES.length,
    );
  });
});

describe("DrillAudience", () => {
  it("isDrillAudience accepts both tiers", () => {
    assert.equal(isDrillAudience("STAFF_ONLY"), true);
    assert.equal(isDrillAudience("EVERYONE"), true);
  });

  it("isDrillAudience rejects garbage", () => {
    assert.equal(isDrillAudience("everyone"), false);
    assert.equal(isDrillAudience(""), false);
    assert.equal(isDrillAudience(undefined), false);
    assert.equal(isDrillAudience({} as unknown), false);
  });

  it("parseDrillAudience round-trips valid input", () => {
    assert.equal(parseDrillAudience("STAFF_ONLY"), "STAFF_ONLY");
    assert.equal(parseDrillAudience("EVERYONE"), "EVERYONE");
  });

  it("parseDrillAudience defaults invalid input to EVERYONE", () => {
    assert.equal(parseDrillAudience(null), "EVERYONE");
    assert.equal(parseDrillAudience("staff_only"), "EVERYONE");
    assert.equal(parseDrillAudience(42), "EVERYONE");
  });

  it("DRILL_AUDIENCE_LABELS has both tiers", () => {
    const labels: Record<DrillAudience, string> = DRILL_AUDIENCE_LABELS;
    assert.equal(typeof labels.STAFF_ONLY, "string");
    assert.equal(typeof labels.EVERYONE, "string");
  });
});
