import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, diffRunStates, synthesizeLifecycleEvents } from "./replay";
import { emptyRunState, type RunState, type DrillEventPayload } from "./types";

function applyAll(start: RunState, events: DrillEventPayload[]): RunState {
  return events.reduce((s, e) => applyEvent(s, e), start);
}

describe("diffRunStates round-trips with applyEvent", () => {
  it("no-op (prev === next) returns empty array", () => {
    const s: RunState = {
      toggles: { "r1:c1": "positive" },
      notes: "hi",
      actionItems: [{ id: "a1", text: "do it", done: false }],
    };
    assert.deepEqual(diffRunStates(s, s), []);
  });

  it("only toggles changed", () => {
    const prev: RunState = {
      toggles: { "r1:c1": "positive", "r2:c2": "negative" },
      notes: "",
      actionItems: [],
    };
    const next: RunState = {
      // r1:c1 unchanged, r2:c2 cleared, r3:c3 added
      toggles: { "r1:c1": "positive", "r3:c3": "positive" },
      notes: "",
      actionItems: [],
    };
    const events = diffRunStates(prev, next);
    assert.deepEqual(applyAll(prev, events), next);
    // Should be 2 events, both cell_toggled, sorted by key
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "cell_toggled");
    assert.equal(events[1].kind, "cell_toggled");
  });

  it("only notes changed", () => {
    const prev: RunState = { toggles: {}, notes: "old", actionItems: [] };
    const next: RunState = { toggles: {}, notes: "new", actionItems: [] };
    const events = diffRunStates(prev, next);
    assert.deepEqual(events, [
      { kind: "notes_changed", prev: "old", next: "new" },
    ]);
    assert.deepEqual(applyAll(prev, events), next);
  });

  it("action item added", () => {
    const prev: RunState = emptyRunState();
    const next: RunState = {
      toggles: {},
      notes: "",
      actionItems: [{ id: "a1", text: "Refill water", done: false }],
    };
    const events = diffRunStates(prev, next);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "action_added");
    assert.deepEqual(applyAll(prev, events), next);
  });

  it("action item edited and toggled", () => {
    const prev: RunState = {
      toggles: {},
      notes: "",
      actionItems: [{ id: "a1", text: "old text", done: false }],
    };
    const next: RunState = {
      toggles: {},
      notes: "",
      actionItems: [{ id: "a1", text: "new text", done: true }],
    };
    const events = diffRunStates(prev, next);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "action_edited");
    assert.equal(events[1].kind, "action_toggled");
    assert.deepEqual(applyAll(prev, events), next);
  });

  it("action item removed", () => {
    const prev: RunState = {
      toggles: {},
      notes: "",
      actionItems: [
        { id: "a1", text: "stay", done: false },
        { id: "a2", text: "go", done: false },
      ],
    };
    const next: RunState = {
      toggles: {},
      notes: "",
      actionItems: [{ id: "a1", text: "stay", done: false }],
    };
    const events = diffRunStates(prev, next);
    assert.deepEqual(events, [{ kind: "action_removed", id: "a2" }]);
    assert.deepEqual(applyAll(prev, events), next);
  });

  it("kitchen-sink combined diff round-trips", () => {
    const prev: RunState = {
      toggles: { "r1:c1": "positive", "r2:c2": "negative" },
      notes: "before",
      actionItems: [
        { id: "a1", text: "stays", done: false },
        { id: "a2", text: "edit me", done: false },
        { id: "a3", text: "remove me", done: false },
      ],
    };
    const next: RunState = {
      toggles: { "r1:c1": "negative", "r3:c3": "positive" },
      notes: "after",
      actionItems: [
        { id: "a1", text: "stays", done: true },
        { id: "a2", text: "edited", done: false },
        { id: "a4", text: "new one", done: false },
      ],
    };
    const events = diffRunStates(prev, next);
    assert.deepEqual(applyAll(prev, events), next);
  });
});

describe("diffRunStates exact event shape", () => {
  it("single cell flip from blank to positive", () => {
    const prev: RunState = emptyRunState();
    const next: RunState = {
      toggles: { "r1:c1": "positive" },
      notes: "",
      actionItems: [],
    };
    assert.deepEqual(diffRunStates(prev, next), [
      { kind: "cell_toggled", key: "r1:c1", prev: null, next: "positive" },
    ]);
  });

  it("single cell flip from positive to blank emits next=null", () => {
    const prev: RunState = {
      toggles: { "r1:c1": "positive" },
      notes: "",
      actionItems: [],
    };
    const next: RunState = emptyRunState();
    assert.deepEqual(diffRunStates(prev, next), [
      { kind: "cell_toggled", key: "r1:c1", prev: "positive", next: null },
    ]);
  });

  it("toggle events are sorted by key", () => {
    const prev: RunState = emptyRunState();
    const next: RunState = {
      toggles: { "z:1": "positive", "a:1": "positive", "m:1": "positive" },
      notes: "",
      actionItems: [],
    };
    const events = diffRunStates(prev, next);
    const keys = events.map((e) =>
      e.kind === "cell_toggled" ? e.key : "",
    );
    assert.deepEqual(keys, ["a:1", "m:1", "z:1"]);
  });
});

describe("applyEvent", () => {
  it("started returns a clone of initialState (different reference)", () => {
    const initial: RunState = {
      toggles: { "r1:c1": "positive" },
      notes: "n",
      actionItems: [{ id: "a1", text: "x", done: false }],
    };
    const out = applyEvent(emptyRunState(), {
      kind: "started",
      initialState: initial,
    });
    assert.deepEqual(out, initial);
    assert.notEqual(out, initial);
    assert.notEqual(out.toggles, initial.toggles);
    assert.notEqual(out.actionItems, initial.actionItems);
    assert.notEqual(out.actionItems[0], initial.actionItems[0]);
    // Mutating the clone must not leak back.
    out.toggles["r9:c9"] = "negative";
    out.actionItems[0].text = "hijacked";
    assert.equal(initial.toggles["r9:c9"], undefined);
    assert.equal(initial.actionItems[0].text, "x");
  });

  it("paused/resumed/ended return state unchanged structurally", () => {
    const state: RunState = {
      toggles: { "r1:c1": "positive" },
      notes: "n",
      actionItems: [],
    };
    assert.deepEqual(applyEvent(state, { kind: "paused" }), state);
    assert.deepEqual(applyEvent(state, { kind: "resumed" }), state);
    assert.deepEqual(applyEvent(state, { kind: "ended" }), state);
  });

  it("cell_toggled with next=null deletes the key", () => {
    const state: RunState = {
      toggles: { "r1:c1": "positive", "r2:c2": "negative" },
      notes: "",
      actionItems: [],
    };
    const out = applyEvent(state, {
      kind: "cell_toggled",
      key: "r1:c1",
      prev: "positive",
      next: null,
    });
    assert.deepEqual(out.toggles, { "r2:c2": "negative" });
  });

  it("action_added pushes with done=false even if input item.done was true", () => {
    const state = emptyRunState();
    const out = applyEvent(state, {
      kind: "action_added",
      item: { id: "a1", text: "do me", done: true },
    });
    assert.equal(out.actionItems.length, 1);
    assert.equal(out.actionItems[0].done, false);
    assert.equal(out.actionItems[0].text, "do me");
  });

  it("action_removed filters by id; missing id is a no-op", () => {
    const state: RunState = {
      toggles: {},
      notes: "",
      actionItems: [{ id: "a1", text: "x", done: false }],
    };
    const removed = applyEvent(state, { kind: "action_removed", id: "a1" });
    assert.deepEqual(removed.actionItems, []);
    const noop = applyEvent(state, { kind: "action_removed", id: "ghost" });
    assert.deepEqual(noop.actionItems, state.actionItems);
  });
});

describe("synthesizeLifecycleEvents", () => {
  it("only activatedAt → 1 event (started)", () => {
    const out = synthesizeLifecycleEvents({
      activatedAt: new Date("2025-01-01T10:00:00Z"),
      pausedAt: null,
      endedAt: null,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, "started");
    assert.deepEqual(
      (out[0].payload as { kind: "started"; initialState: RunState })
        .initialState,
      emptyRunState(),
    );
  });

  it("activatedAt + endedAt → 2 events sorted by occurredAt", () => {
    const out = synthesizeLifecycleEvents({
      activatedAt: new Date("2025-01-01T10:00:00Z"),
      pausedAt: null,
      endedAt: new Date("2025-01-01T10:30:00Z"),
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].kind, "started");
    assert.equal(out[1].kind, "ended");
    assert.ok(out[0].occurredAt.getTime() < out[1].occurredAt.getTime());
  });

  it("activatedAt + pausedAt + endedAt → 3 events sorted by occurredAt", () => {
    const out = synthesizeLifecycleEvents({
      activatedAt: new Date("2025-01-01T10:00:00Z"),
      pausedAt: new Date("2025-01-01T10:15:00Z"),
      endedAt: new Date("2025-01-01T10:30:00Z"),
    });
    assert.equal(out.length, 3);
    assert.equal(out[0].kind, "started");
    assert.equal(out[1].kind, "paused");
    assert.equal(out[2].kind, "ended");
  });

  it("null activatedAt falls back to epoch (Date(0))", () => {
    const out = synthesizeLifecycleEvents({
      activatedAt: null,
      pausedAt: null,
      endedAt: null,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].occurredAt.getTime(), 0);
  });
});
