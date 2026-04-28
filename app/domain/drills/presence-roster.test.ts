import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitPresenceRoster,
  type RosterPresenceEntry,
} from "./presence-roster";

function entry(over: Partial<RosterPresenceEntry>): RosterPresenceEntry {
  return {
    userId: "u1",
    label: "Alice",
    onBehalfOfUserId: null,
    onBehalfOfLabel: null,
    color: "hsl(0 0% 50%)",
    focus: null,
    at: 0,
    ...over,
  };
}

describe("splitPresenceRoster", () => {
  it("returns empty split when given no entries", () => {
    const split = splitPresenceRoster([]);
    assert.deepEqual(split, { authedRoster: [], guestCount: 0 });
  });

  it("collects all guests (label === null) into a count", () => {
    const split = splitPresenceRoster([
      entry({ userId: "g1", label: null }),
      entry({ userId: "g2", label: null }),
      entry({ userId: "g3", label: null }),
    ]);
    assert.equal(split.authedRoster.length, 0);
    assert.equal(split.guestCount, 3);
  });

  it("collects authed users (non-null label) and ignores them in guestCount", () => {
    const split = splitPresenceRoster([
      entry({ userId: "u1", label: "Alice" }),
      entry({ userId: "u2", label: "Bob" }),
    ]);
    assert.equal(split.authedRoster.length, 2);
    assert.equal(split.guestCount, 0);
  });

  it("splits a mixed roster correctly", () => {
    const split = splitPresenceRoster([
      entry({ userId: "u1", label: "Alice" }),
      entry({ userId: "g1", label: null }),
      entry({ userId: "u2", label: "Bob" }),
      entry({ userId: "g2", label: null }),
    ]);
    assert.equal(split.authedRoster.length, 2);
    assert.equal(split.guestCount, 2);
    const ids = split.authedRoster.map((e) => e.userId).sort();
    assert.deepEqual(ids, ["u1", "u2"]);
  });

  it("sorts authed roster by `at` desc (most recent first)", () => {
    const split = splitPresenceRoster([
      entry({ userId: "u1", label: "Alice", at: 100 }),
      entry({ userId: "u2", label: "Bob", at: 300 }),
      entry({ userId: "u3", label: "Carol", at: 200 }),
    ]);
    const ids = split.authedRoster.map((e) => e.userId);
    assert.deepEqual(ids, ["u2", "u3", "u1"]);
  });

  it("breaks ties on `at` deterministically by userId", () => {
    const split = splitPresenceRoster([
      entry({ userId: "u3", label: "Carol", at: 100 }),
      entry({ userId: "u1", label: "Alice", at: 100 }),
      entry({ userId: "u2", label: "Bob", at: 100 }),
    ]);
    const ids = split.authedRoster.map((e) => e.userId);
    assert.deepEqual(ids, ["u1", "u2", "u3"]);
  });

  it("preserves entry shape exactly (no field drops)", () => {
    const e = entry({
      userId: "u1",
      label: "Alice",
      onBehalfOfUserId: "u2",
      onBehalfOfLabel: "Bob",
      color: "hsl(120 70% 60%)",
      focus: { kind: "notes" },
      at: 1000,
    });
    const split = splitPresenceRoster([e]);
    assert.deepEqual(split.authedRoster[0], e);
  });
});
