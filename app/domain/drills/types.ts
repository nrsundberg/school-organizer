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
  /**
   * Optional follow-up tasks pre-populated on every fresh run started from
   * this template (e.g. "Refill first-aid kit", "Notify district office").
   * Items become unchecked `ActionItem`s in the new run's `RunState` so
   * runners can tick them off during/after the drill.
   */
  defaultActionItems?: string[];
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

/**
 * Live-drill audience scoping. STAFF_ONLY hides the takeover from viewer-pin
 * guests (they continue to see the normal board); EVERYONE shows it to staff
 * and viewer-pin guests. Anonymous callers (no user, no viewer pin) are never
 * redirected regardless of audience.
 */
export type DrillAudience = "STAFF_ONLY" | "EVERYONE";

export const DRILL_AUDIENCES: readonly DrillAudience[] = [
  "STAFF_ONLY",
  "EVERYONE",
] as const;

export const DRILL_AUDIENCE_LABELS: Record<DrillAudience, string> = {
  STAFF_ONLY: "Staff only",
  EVERYONE: "Everyone",
};

export function isDrillAudience(v: unknown): v is DrillAudience {
  return v === "STAFF_ONLY" || v === "EVERYONE";
}

/**
 * Coerce arbitrary input (DB column read, form value) to a `DrillAudience`,
 * defaulting to "EVERYONE" so older rows / corrupt input behave like
 * pre-feature visibility (everyone in audience).
 */
export function parseDrillAudience(v: unknown): DrillAudience {
  return isDrillAudience(v) ? v : "EVERYONE";
}

/**
 * Drill mode — distinguishes planned exercises from real events captured in
 * the same UI. State DOEs typically require this distinction for compliance.
 * "DRILL" is the historical default; everything before this feature shipped
 * was, by definition, a drill.
 */
export type DrillMode = "DRILL" | "ACTUAL" | "FALSE_ALARM";

export const DRILL_MODES: readonly DrillMode[] = [
  "DRILL",
  "ACTUAL",
  "FALSE_ALARM",
] as const;

export const DRILL_MODE_LABELS: Record<DrillMode, string> = {
  DRILL: "Drill",
  ACTUAL: "Real event",
  FALSE_ALARM: "False alarm",
};

export function isDrillMode(v: unknown): v is DrillMode {
  return v === "DRILL" || v === "ACTUAL" || v === "FALSE_ALARM";
}

/**
 * Coerce arbitrary input (DB column read, form value) to a `DrillMode`,
 * defaulting to "DRILL" so older rows / corrupt input read as planned
 * exercises (matches the column default and pre-feature semantics).
 */
export function parseDrillMode(v: unknown): DrillMode {
  return isDrillMode(v) ? v : "DRILL";
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

/**
 * One classroom's "I'm accounted for" attestation, captured per-row on the
 * shared run sheet. Lets each teacher (or the staffer holding their phone)
 * sign off "all 22 of my kids are here / I have an issue" without forcing
 * everyone to share the same toggle column. The shared-spreadsheet model
 * (toggles / notes / actionItems) stays untouched — this is purely an
 * additive overlay layered on top.
 *
 *   - byUserId   — actor's user id when the click happened on the staff
 *                  side; null on viewer-pin / anonymous clicks.
 *   - byLabel    — display name to show inline ("Mrs. Smith", "Room 204").
 *                  Always populated so the row always renders something
 *                  even when byUserId is null.
 *   - attestedAt — ISO timestamp; renders as HH:MM next to the byLabel.
 *   - status     — "all-clear" by default; flipped to "issue" when the
 *                  teacher needs to flag a missing student / problem.
 *   - note       — optional free-text shown next to "issue" attestations.
 */
export interface ClassroomAttestation {
  byUserId: string | null;
  byLabel: string;
  attestedAt: string;
  status: "all-clear" | "issue";
  note?: string;
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
  /**
   * Per-classroom attestation overlay, keyed by the row id from the
   * template definition (one row = one classroom). Missing key means the
   * row hasn't been attested yet. Older RunState payloads predate this
   * field — `parseRunState` defaults missing/garbage entries to `{}`.
   */
  classroomAttestations: Record<string, ClassroomAttestation>;
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
  return {
    toggles: {},
    notes: "",
    actionItems: [],
    classroomAttestations: {},
  };
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

  const defaultActionItems = Array.isArray(def.defaultActionItems)
    ? def.defaultActionItems
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  const result: TemplateDefinition = { columns, rows };
  if (sections && sections.length > 0) {
    result.sections = sections;
  }
  if (defaultActionItems && defaultActionItems.length > 0) {
    result.defaultActionItems = defaultActionItems;
  }
  return result;
}

/**
 * Build a fresh `RunState` for a new run started from this template,
 * pre-populating the follow-up checklist with the template's default items.
 * Notes/toggles always start blank — only the action-item list is seeded.
 */
export function seedRunStateFromTemplate(def: TemplateDefinition): RunState {
  const state = emptyRunState();
  if (def.defaultActionItems && def.defaultActionItems.length > 0) {
    state.actionItems = def.defaultActionItems.map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    }));
  }
  return state;
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
  | "action_removed"
  | "row_attested"
  | "row_unattested";

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
  | { kind: "action_removed"; id: string }
  | {
      kind: "row_attested";
      rowId: string;
      prev: ClassroomAttestation | null;
      next: ClassroomAttestation;
    }
  | {
      kind: "row_unattested";
      rowId: string;
      prev: ClassroomAttestation;
    };

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
    v === "action_removed" ||
    v === "row_attested" ||
    v === "row_unattested"
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
 * Coerce arbitrary stored value into a `ClassroomAttestation`. Returns
 * `null` when the input can't be salvaged so callers (parseRunState,
 * parseDrillEventPayload) can drop the row defensively rather than render
 * a partial entry.
 */
function parseClassroomAttestation(raw: unknown): ClassroomAttestation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ClassroomAttestation> & { byUserId?: unknown };
  // attestedAt + byLabel are the two display-load-bearing fields; if either
  // is missing we'd render "✓ undefined @ NaN", so drop the entry.
  if (typeof r.attestedAt !== "string" || typeof r.byLabel !== "string") {
    return null;
  }
  const status: ClassroomAttestation["status"] =
    r.status === "issue" ? "issue" : "all-clear";
  const byUserId =
    typeof r.byUserId === "string" && r.byUserId.length > 0 ? r.byUserId : null;
  const out: ClassroomAttestation = {
    byUserId,
    byLabel: r.byLabel,
    attestedAt: r.attestedAt,
    status,
  };
  if (typeof r.note === "string" && r.note.length > 0) {
    out.note = r.note;
  }
  return out;
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
    case "row_attested": {
      const rowId = typeof p.rowId === "string" ? p.rowId : null;
      if (!rowId) return null;
      const next = parseClassroomAttestation(p.next);
      if (!next) return null;
      const prev = parseClassroomAttestation(p.prev);
      return { kind, rowId, prev, next };
    }
    case "row_unattested": {
      const rowId = typeof p.rowId === "string" ? p.rowId : null;
      if (!rowId) return null;
      const prev = parseClassroomAttestation(p.prev);
      if (!prev) return null;
      return { kind, rowId, prev };
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
  // Per-classroom attestation overlay. Older RunState payloads predate
  // the field; treat missing/garbage as `{}`. Each entry is run through
  // the per-attestation coercer so a single corrupt row doesn't poison
  // the rest of the overlay.
  const classroomAttestations: Record<string, ClassroomAttestation> = {};
  if (
    s.classroomAttestations &&
    typeof s.classroomAttestations === "object" &&
    !Array.isArray(s.classroomAttestations)
  ) {
    for (const [rowId, val] of Object.entries(
      s.classroomAttestations as Record<string, unknown>,
    )) {
      const parsed = parseClassroomAttestation(val);
      if (parsed) {
        classroomAttestations[rowId] = parsed;
      }
    }
  }
  return { toggles, notes, actionItems, classroomAttestations };
}
