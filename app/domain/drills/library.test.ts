import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_TEMPLATES, getGlobalTemplate } from "./library";
import { DRILL_TYPES, isDrillType, parseTemplateDefinition } from "./types";

const SLUG_RE = /^[a-z0-9-]+$/;

describe("GLOBAL_TEMPLATES", () => {
  it("contains at least 12 templates", () => {
    assert.ok(
      GLOBAL_TEMPLATES.length >= 12,
      `Expected at least 12 templates, got ${GLOBAL_TEMPLATES.length}`,
    );
  });

  it("every template has a unique globalKey", () => {
    const keys = GLOBAL_TEMPLATES.map((t) => t.globalKey);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, "globalKey collisions detected");
  });

  it("every globalKey matches /^[a-z0-9-]+$/", () => {
    for (const t of GLOBAL_TEMPLATES) {
      assert.ok(
        SLUG_RE.test(t.globalKey),
        `"${t.globalKey}" is not a valid kebab-case slug`,
      );
    }
  });

  it("every drillType is a valid DrillType", () => {
    for (const t of GLOBAL_TEMPLATES) {
      assert.ok(
        isDrillType(t.drillType),
        `"${t.globalKey}" uses unknown drillType "${t.drillType}"`,
      );
      assert.ok(
        (DRILL_TYPES as readonly string[]).includes(t.drillType),
        `"${t.globalKey}" drillType not in DRILL_TYPES`,
      );
    }
  });

  it("every definition survives a JSON round-trip through parseTemplateDefinition", () => {
    for (const t of GLOBAL_TEMPLATES) {
      const cloned = JSON.parse(JSON.stringify(t.definition));
      const parsed = parseTemplateDefinition(cloned);
      assert.equal(
        parsed.columns.length,
        t.definition.columns.length,
        `${t.globalKey}: column count changed on round-trip`,
      );
      assert.equal(
        parsed.rows.length,
        t.definition.rows.length,
        `${t.globalKey}: row count changed on round-trip`,
      );
      if (t.definition.sections) {
        assert.ok(parsed.sections, `${t.globalKey}: sections dropped on round-trip`);
        assert.equal(parsed.sections!.length, t.definition.sections.length);
      }
    }
  });

  it("every row's sectionId (when present) references a real section", () => {
    for (const t of GLOBAL_TEMPLATES) {
      const sectionIds = new Set(t.definition.sections?.map((s) => s.id) ?? []);
      for (const r of t.definition.rows) {
        if (r.sectionId) {
          assert.ok(
            sectionIds.has(r.sectionId),
            `${t.globalKey}: row ${r.id} references unknown sectionId "${r.sectionId}"`,
          );
        }
      }
    }
  });

  it("every row's cell keys are a subset of the template's column ids", () => {
    for (const t of GLOBAL_TEMPLATES) {
      const colIds = new Set(t.definition.columns.map((c) => c.id));
      for (const r of t.definition.rows) {
        for (const cid of Object.keys(r.cells)) {
          assert.ok(
            colIds.has(cid),
            `${t.globalKey}: row ${r.id} has cell for unknown column "${cid}"`,
          );
        }
      }
    }
  });

  it("every template has non-empty name, authority, description, instructions", () => {
    for (const t of GLOBAL_TEMPLATES) {
      assert.ok(t.name && t.name.trim().length > 0, `${t.globalKey}: missing name`);
      assert.ok(
        t.authority && t.authority.trim().length > 0,
        `${t.globalKey}: missing authority`,
      );
      assert.ok(
        t.description && t.description.trim().length > 0,
        `${t.globalKey}: missing description`,
      );
      assert.ok(
        t.instructions && t.instructions.trim().length > 0,
        `${t.globalKey}: missing instructions`,
      );
    }
  });
});

describe("getGlobalTemplate", () => {
  it("returns the matching template for a known key", () => {
    const t = getGlobalTemplate("fire-evacuation");
    assert.ok(t, "expected fire-evacuation template to exist");
    assert.equal(t!.globalKey, "fire-evacuation");
    assert.equal(t!.drillType, "FIRE");
  });

  it("returns undefined for an unknown key", () => {
    assert.equal(getGlobalTemplate("nope-not-real"), undefined);
    assert.equal(getGlobalTemplate(""), undefined);
  });
});
