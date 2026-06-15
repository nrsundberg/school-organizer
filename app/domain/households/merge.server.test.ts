import assert from "node:assert/strict";
import test from "node:test";
import { groupDuplicateHouseholds, type HouseholdLite } from "./merge.server";

function h(id: string, spaceNumber: number | null, createdAt: string): HouseholdLite {
  return { id, spaceNumber, createdAt: new Date(createdAt) };
}

test("groupDuplicateHouseholds: groups non-null spaces with >1 member", () => {
  const groups = groupDuplicateHouseholds([
    h("a", 12, "2026-01-01"),
    h("b", 12, "2026-01-02"),
    h("c", 13, "2026-01-01"), // singleton, excluded
    h("d", null, "2026-01-01"), // null space, excluded
    h("e", null, "2026-01-02"), // null space, excluded (nulls never group)
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((x) => x.id), ["a", "b"]);
});

test("groupDuplicateHouseholds: each group is ordered oldest-first (survivor first)", () => {
  const groups = groupDuplicateHouseholds([
    h("late", 5, "2026-03-01"),
    h("early", 5, "2026-01-01"),
    h("mid", 5, "2026-02-01"),
  ]);

  assert.deepEqual(groups[0].map((x) => x.id), ["early", "mid", "late"]);
});

test("groupDuplicateHouseholds: empty input -> no groups", () => {
  assert.deepEqual(groupDuplicateHouseholds([]), []);
});
