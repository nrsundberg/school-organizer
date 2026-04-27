import type { Prisma } from "~/db";

export type ColumnKind = "text" | "toggle";

export interface ColumnDef {
  id: string;
  label: string;
  kind: ColumnKind;
}

export interface RowDef {
  id: string;
  /** Values for text columns only; keys are column ids */
  cells: Record<string, string>;
  /** Optional grouping — matches SectionDef.id */
  sectionId?: string;
}

export interface SectionDef {
  id: string;
  label: string;
}

export interface TemplateDefinition {
  columns: ColumnDef[];
  rows: RowDef[];
  /** Optional row groupings — e.g. "During" vs "After" for earthquake drills */
  sections?: SectionDef[];
}

/**
 * Drill categories aligned to Standard Response Protocol (SRP v4.2) +
 * common school-drill taxonomy (NFPA, FEMA REMS, state DOEs).
 */
export type DrillType =
  | "FIRE"
  | "LOCKDOWN"
  | "SECURE"
  | "HOLD"
  | "EVACUATE"
  | "SHELTER"
  | "SEVERE_WEATHER"
  | "EARTHQUAKE"
  | "REUNIFICATION"
  | "BUS"
  | "BOMB_THREAT"
  | "MEDICAL"
  | "OTHER";

export const DRILL_TYPES: readonly DrillType[] = [
  "FIRE",
  "LOCKDOWN",
  "SECURE",
  "HOLD",
  "EVACUATE",
  "SHELTER",
  "SEVERE_WEATHER",
  "EARTHQUAKE",
  "REUNIFICATION",
  "BUS",
  "BOMB_THREAT",
  "MEDICAL",
  "OTHER",
] as const;

export const DRILL_TYPE_LABELS: Record<DrillType, string> = {
  FIRE: "Fire evacuation",
  LOCKDOWN: "Lockdown",
  SECURE: "Secure",
  HOLD: "Hold",
  EVACUATE: "Evacuate (non-fire)",
  SHELTER: "Shelter-in-place",
  SEVERE_WEATHER: "Severe weather / Tornado",
  EARTHQUAKE: "Earthquake",
  REUNIFICATION: "Reunification",
  BUS: "Bus evacuation",
  BOMB_THREAT: "Bomb threat",
  MEDICAL: "Medical / AED",
  OTHER: "Other",
};

export function isDrillType(v: unknown): v is DrillType {
  return typeof v === "string" && (DRILL_TYPES as readonly string[]).includes(v);
}

/**
 * DrillRun lifecycle:
 *   DRAFT  → never activated (initial state)
 *   LIVE   → active, everyone in org sees + interacts
 *   PAUSED → frozen, read-only (admins can Resume or End)
 *   ENDED  → terminal historical record
 */
export type DrillRunStatus = "DRAFT" | "LIVE" | "PAUSED" | "ENDED";

export const DRILL_RUN_STATUS_LABELS: Record<DrillRunStatus, string> = {
  DRAFT: "Draft",
  LIVE: "Live",
  PAUSED: "Paused",
  ENDED: "Ended",
};

export function isDrillRunStatus(v: unknown): v is DrillRunStatus {
  return v === "DRAFT" || v === "LIVE" || v === "PAUSED" || v === "ENDED";
}

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

/**
 * A toggle cell's explicit state. Absence of the key in `RunState.toggles`
 * means "blank / not yet answered" — the tri-state has three visible
 * values: blank, positive (check), negative (X). We store only the two
 * explicit values and omit the key for blank, so saves stay compact and
 * the migration from the old boolean shape is trivial (true → positive,
 * false → dropped = blank).
 */
export type ToggleValue = "positive" | "negative";

export const TOGGLE_CYCLE: readonly (ToggleValue | null)[] = [
  null,
  "positive",
  "negative",
] as const;

/**
 * Next state in the blank → positive → negative → blank cycle. Used by
 * both the admin run screen and the live drill screen so the behavior is
 * identical everywhere teachers click.
 */
export function cycleToggle(cur: ToggleValue | null | undefined): ToggleValue | null {
  if (cur === "positive") return "negative";
  if (cur === "negative") return null;
  return "positive";
}

export interface RunState {
  /**
   * Map of `${rowId}:${colId}` → ToggleValue. Keys missing from the map
   * are treated as blank. Old runs stored booleans here; `parseRunState`
   * migrates them on read.
   */
  toggles: Record<string, ToggleValue>;
  notes: string;
  actionItems: ActionItem[];
}

function newId(): string {
  return crypto.randomUUID();
}

export function defaultTemplateDefinition(): TemplateDefinition {
  const colGrade = newId();
  const colTeacher = newId();
  const colCheck = newId();
  const row1 = newId();
  const row2 = newId();
  return {
    columns: [
      { id: colGrade, label: "Grade", kind: "text" },
      { id: colTeacher, label: "Teacher", kind: "text" },
      { id: colCheck, label: "Check", kind: "toggle" },
    ],
    rows: [
      {
        id: row1,
        cells: { [colGrade]: "K", [colTeacher]: "Example" },
      },
      {
        id: row2,
        cells: { [colGrade]: "Specials", [colTeacher]: "" },
      },
    ],
  };
}

export function emptyRunState(): RunState {
  return { toggles: {}, notes: "", actionItems: [] };
}

export function toggleKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

/** Coerce Prisma JSON into TemplateDefinition and fill missing text cells */
export function parseTemplateDefinition(raw: Prisma.JsonValue): TemplateDefinition {
  const obj = raw as unknown;
  if (!obj || typeof obj !== "object") {
    return defaultTemplateDefinition();
  }
  const def = obj as Partial<TemplateDefinition>;
  const columns = Array.isArray(def.columns)
    ? def.columns
        .filter((c): c is ColumnDef => !!c && typeof c === "object" && typeof (c as ColumnDef).id === "string")
        .map((c) => ({
          id: c.id,
          label: typeof c.label === "string" ? c.label : "Column",
          kind: (c.kind === "toggle" ? "toggle" : "text") as ColumnKind,
        }))
    : [];
  const sections = Array.isArray(def.sections)
    ? def.sections
        .filter(
          (s): s is SectionDef =>
            !!s && typeof s === "object" && typeof (s as SectionDef).id === "string",
        )
        .map((s) => ({
          id: s.id,
          label: typeof s.label === "string" ? s.label : "Section",
        }))
    : undefined;
  const validSectionIds = new Set(sections?.map((s) => s.id) ?? []);

  const rows = Array.isArray(def.rows)
    ? def.rows
        .filter((r): r is RowDef => !!r && typeof r === "object" && typeof (r as RowDef).id === "string")
        .map((r) => {
          const row: RowDef = {
            id: r.id,
            cells: typeof r.cells === "object" && r.cells !== null ? { ...r.cells } : {},
          };
          if (typeof r.sectionId === "string" && validSectionIds.has(r.sectionId)) {
            row.sectionId = r.sectionId;
          }
          return row;
        })
    : [];

  if (columns.length === 0) {
    return defaultTemplateDefinition();
  }

  const textColIds = new Set(columns.filter((c) => c.kind === "text").map((c) => c.id));
  for (const row of rows) {
    for (const cid of textColIds) {
      if (row.cells[cid] === undefined) {
        row.cells[cid] = "";
      }
    }
  }

  const result: TemplateDefinition = { columns, rows };
  if (sections && sections.length > 0) {
    result.sections = sections;
  }
  return result;
}

/**
 * The replay log: discrete deltas applied to a `RunState` over the course of
 * a single DrillRun. Persisted one-row-per-event in the `DrillRunEvent` table
 * so the history page can scrub through every change. The `applyEvent` /
 * `diffRunStates` helpers in `./replay` are the canonical reducers.
 */
export type DrillEventKind =
  | "started"
  | "paused"
  | "resumed"
  | "ended"
  | "cell_toggled"
  | "notes_changed"
  | "action_added"
  | "action_edited"
  | "action_toggled"
  | "action_removed";

export type DrillEventPayload =
  | { kind: "started"; initialState: RunState }
  | { kind: "paused" }
  | { kind: "resumed" }
  | { kind: "ended" }
  | {
      kind: "cell_toggled";
      key: string;
      prev: ToggleValue | null;
      next: ToggleValue | null;
    }
  | { kind: "notes_changed"; prev: string; next: string }
  | { kind: "action_added"; item: ActionItem }
  | { kind: "action_edited"; id: string; prev: string; next: string }
  | { kind: "action_toggled"; id: string; prev: boolean; next: boolean }
  | { kind: "action_removed"; id: string };

export function isDrillEventKind(v: unknown): v is DrillEventKind {
  return (
    v === "started" ||
    v === "paused" ||
    v === "resumed" ||
    v === "ended" ||
    v === "cell_toggled" ||
    v === "notes_changed" ||
    v === "action_added" ||
    v === "action_edited" ||
    v === "action_toggled" ||
    v === "action_removed"
  );
}

function parseToggleOrNull(v: unknown): ToggleValue | null {
  return v === "positive" || v === "negative" ? v : null;
}

function parseActionItem(raw: unknown): ActionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ActionItem>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    text: typeof r.text === "string" ? r.text : "",
    done: !!r.done,
  };
}

/**
 * Coerce a stored payload (possibly stale or corrupt) into a `DrillEventPayload`.
 * Returns `null` when the payload can't be salvaged; callers should drop those
 * events on read rather than crash the page.
 */
export function parseDrillEventPayload(
  kind: string,
  raw: Prisma.JsonValue,
): DrillEventPayload | null {
  if (!isDrillEventKind(kind)) return null;
  const p = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  switch (kind) {
    case "started":
      return { kind, initialState: parseRunState((p.initialState as Prisma.JsonValue) ?? {}) };
    case "paused":
    case "resumed":
    case "ended":
      return { kind };
    case "cell_toggled": {
      const key = typeof p.key === "string" ? p.key : null;
      if (!key) return null;
      return {
        kind,
        key,
        prev: parseToggleOrNull(p.prev),
        next: parseToggleOrNull(p.next),
      };
    }
    case "notes_changed":
      return {
        kind,
        prev: typeof p.prev === "string" ? p.prev : "",
        next: typeof p.next === "string" ? p.next : "",
      };
    case "action_added": {
      const item = parseActionItem(p.item);
      if (!item) return null;
      return { kind, item };
    }
    case "action_edited": {
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) return null;
      return {
        kind,
        id,
        prev: typeof p.prev === "string" ? p.prev : "",
        next: typeof p.next === "string" ? p.next : "",
      };
    }
    case "action_toggled": {
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) return null;
      return { kind, id, prev: !!p.prev, next: !!p.next };
    }
    case "action_removed": {
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) return null;
      return { kind, id };
    }
  }
}

export function parseRunState(raw: Prisma.JsonValue): RunState {
  const obj = raw as unknown;
  if (!obj || typeof obj !== "object") {
    return emptyRunState();
  }
  const s = obj as Partial<RunState>;
  // Migrate legacy boolean toggles while tolerating the new string form.
  //   - `true`       → "positive"
  //   - `false`      → dropped (blank)
  //   - "positive"   → kept
  //   - "negative"   → kept
  //   - anything else → dropped (defensive — don't poison state if the
  //     stored JSON is corrupt)
  // Absence of a key means blank in the tri-state model.
  const toggles: Record<string, ToggleValue> = {};
  if (s.toggles && typeof s.toggles === "object" && !Array.isArray(s.toggles)) {
    for (const [key, val] of Object.entries(s.toggles as Record<string, unknown>)) {
      if (val === true || val === "positive") {
        toggles[key] = "positive";
      } else if (val === "negative") {
        toggles[key] = "negative";
      }
      // `false` and everything else → blank (omit).
    }
  }
  const notes = typeof s.notes === "string" ? s.notes : "";
  const actionItems = Array.isArray(s.actionItems)
    ? s.actionItems
        .filter((a): a is ActionItem => !!a && typeof a === "object" && typeof (a as ActionItem).id === "string")
        .map((a) => ({
          id: a.id,
          text: typeof a.text === "string" ? a.text : "",
          done: !!a.done,
        }))
    : [];
  return { toggles, notes, actionItems };
}
