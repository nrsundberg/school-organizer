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

export interface RunState {
  toggles: Record<string, boolean>;
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

export function parseRunState(raw: Prisma.JsonValue): RunState {
  const obj = raw as unknown;
  if (!obj || typeof obj !== "object") {
    return emptyRunState();
  }
  const s = obj as Partial<RunState>;
  const toggles =
    s.toggles && typeof s.toggles === "object" && s.toggles !== null && !Array.isArray(s.toggles)
      ? { ...(s.toggles as Record<string, boolean>) }
      : {};
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
