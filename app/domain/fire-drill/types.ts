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
}

export interface TemplateDefinition {
  columns: ColumnDef[];
  rows: RowDef[];
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
  const rows = Array.isArray(def.rows)
    ? def.rows
        .filter((r): r is RowDef => !!r && typeof r === "object" && typeof (r as RowDef).id === "string")
        .map((r) => ({
          id: r.id,
          cells: typeof r.cells === "object" && r.cells !== null ? { ...r.cells } : {},
        }))
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

  return { columns, rows };
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
