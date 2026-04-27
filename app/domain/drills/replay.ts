// app/domain/drills/replay.ts
//
// Pure-function layer for the drill-run replay feature. The server uses
// `diffRunStates` to emit one DrillRunEvent per discrete change inside
// `updateLiveRunState`; the client uses `applyEvent` to walk those events
// forward from the run's initial state when scrubbing the history-page
// timeline. `synthesizeLifecycleEvents` is a defensive fallback for runs
// that somehow have zero stored events.
//
// No React, no Prisma, no I/O — keep it that way so both sides can import
// without pulling in platform code.

import type {
  ClassroomAttestation,
  RunState,
  DrillEventPayload,
  DrillEventKind,
  ToggleValue,
} from "./types";
import { emptyRunState } from "./types";

/** Deep-clone a RunState so callers can mutate freely without leaking refs. */
function cloneRunState(state: RunState): RunState {
  return {
    toggles: { ...state.toggles },
    notes: state.notes,
    actionItems: state.actionItems.map((a) => ({ ...a })),
    classroomAttestations: cloneAttestations(state.classroomAttestations),
  };
}

function cloneAttestations(
  src: Record<string, ClassroomAttestation>,
): Record<string, ClassroomAttestation> {
  const out: Record<string, ClassroomAttestation> = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = { ...v };
  }
  return out;
}

/**
 * Structural equality check used by `diffRunStates` to know whether a
 * row's attestation entry actually changed (avoid emitting a fresh
 * row_attested event when only the surrounding state moved). Note key
 * is treated as undefined === missing so existing entries don't
 * misclassify as changed.
 */
function attestationsEqual(
  a: ClassroomAttestation,
  b: ClassroomAttestation,
): boolean {
  return (
    a.byUserId === b.byUserId &&
    a.byLabel === b.byLabel &&
    a.attestedAt === b.attestedAt &&
    a.status === b.status &&
    (a.note ?? "") === (b.note ?? "")
  );
}

/** Minimal ordered delta from `prev` → `next`. No-op pairs emit nothing. */
export function diffRunStates(
  prev: RunState,
  next: RunState,
): DrillEventPayload[] {
  const events: DrillEventPayload[] = [];

  // Toggles: union of keys, sorted for determinism. Missing key === blank.
  const keys = new Set<string>([
    ...Object.keys(prev.toggles),
    ...Object.keys(next.toggles),
  ]);
  const sortedKeys = [...keys].sort();
  for (const key of sortedKeys) {
    const p: ToggleValue | null = prev.toggles[key] ?? null;
    const n: ToggleValue | null = next.toggles[key] ?? null;
    if (p !== n) {
      events.push({ kind: "cell_toggled", key, prev: p, next: n });
    }
  }

  if (prev.notes !== next.notes) {
    events.push({ kind: "notes_changed", prev: prev.notes, next: next.notes });
  }

  const prevById = new Map(prev.actionItems.map((a) => [a.id, a]));
  const nextById = new Map(next.actionItems.map((a) => [a.id, a]));

  // Order: added → edited → toggled → removed. Stable within each bucket
  // by walking next.actionItems / prev.actionItems in their existing order.
  for (const item of next.actionItems) {
    if (!prevById.has(item.id)) {
      events.push({ kind: "action_added", item: { ...item } });
    }
  }
  for (const item of next.actionItems) {
    const p = prevById.get(item.id);
    if (p && p.text !== item.text) {
      events.push({
        kind: "action_edited",
        id: item.id,
        prev: p.text,
        next: item.text,
      });
    }
  }
  for (const item of next.actionItems) {
    const p = prevById.get(item.id);
    if (p && p.done !== item.done) {
      events.push({
        kind: "action_toggled",
        id: item.id,
        prev: p.done,
        next: item.done,
      });
    }
  }
  for (const item of prev.actionItems) {
    if (!nextById.has(item.id)) {
      events.push({ kind: "action_removed", id: item.id });
    }
  }

  // Per-classroom attestations. Mirror the toggles loop: union of row ids,
  // sorted for determinism so two equivalent diffs always emit the same
  // event sequence (matters for replay tests). Three transitions:
  //   - missing → present  : row_attested(prev=null, next)
  //   - present → present' : row_attested(prev, next) when entry changed
  //   - present → missing  : row_unattested(prev)
  const attestKeys = new Set<string>([
    ...Object.keys(prev.classroomAttestations),
    ...Object.keys(next.classroomAttestations),
  ]);
  for (const rowId of [...attestKeys].sort()) {
    const p = prev.classroomAttestations[rowId];
    const n = next.classroomAttestations[rowId];
    if (!p && n) {
      events.push({ kind: "row_attested", rowId, prev: null, next: { ...n } });
    } else if (p && !n) {
      events.push({ kind: "row_unattested", rowId, prev: { ...p } });
    } else if (p && n && !attestationsEqual(p, n)) {
      events.push({
        kind: "row_attested",
        rowId,
        prev: { ...p },
        next: { ...n },
      });
    }
  }

  return events;
}

/** Fold one event onto state without mutating the input. */
export function applyEvent(
  state: RunState,
  event: DrillEventPayload,
): RunState {
  switch (event.kind) {
    case "started":
      return cloneRunState(event.initialState);
    case "paused":
    case "resumed":
    case "ended":
      return state;
    case "cell_toggled": {
      const toggles = { ...state.toggles };
      if (event.next === null) {
        delete toggles[event.key];
      } else {
        toggles[event.key] = event.next;
      }
      return { ...state, toggles };
    }
    case "notes_changed":
      return { ...state, notes: event.next };
    case "action_added":
      return {
        ...state,
        actionItems: [
          ...state.actionItems,
          { ...event.item, done: false },
        ],
      };
    case "action_edited":
      return {
        ...state,
        actionItems: state.actionItems.map((a) =>
          a.id === event.id ? { ...a, text: event.next } : a,
        ),
      };
    case "action_toggled":
      return {
        ...state,
        actionItems: state.actionItems.map((a) =>
          a.id === event.id ? { ...a, done: event.next } : a,
        ),
      };
    case "action_removed":
      return {
        ...state,
        actionItems: state.actionItems.filter((a) => a.id !== event.id),
      };
    case "row_attested": {
      const classroomAttestations = {
        ...state.classroomAttestations,
        [event.rowId]: { ...event.next },
      };
      return { ...state, classroomAttestations };
    }
    case "row_unattested": {
      const classroomAttestations = { ...state.classroomAttestations };
      delete classroomAttestations[event.rowId];
      return { ...state, classroomAttestations };
    }
  }
}

/** Defensive fallback for runs with no stored events — keeps history page sane. */
export function synthesizeLifecycleEvents(run: {
  activatedAt: Date | null;
  pausedAt: Date | null;
  endedAt: Date | null;
}): Array<{ kind: DrillEventKind; payload: DrillEventPayload; occurredAt: Date }> {
  const out: Array<{
    kind: DrillEventKind;
    payload: DrillEventPayload;
    occurredAt: Date;
  }> = [];
  out.push({
    kind: "started",
    payload: { kind: "started", initialState: emptyRunState() },
    occurredAt: run.activatedAt ?? new Date(0),
  });
  if (run.pausedAt) {
    out.push({
      kind: "paused",
      payload: { kind: "paused" },
      occurredAt: run.pausedAt,
    });
  }
  if (run.endedAt) {
    out.push({
      kind: "ended",
      payload: { kind: "ended" },
      occurredAt: run.endedAt,
    });
  }
  out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return out;
}
