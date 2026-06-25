import { Link, data, redirect, useFetcher } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Eye,
  FileText,
  ListChecks,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { StartLivePopover } from "~/domain/drills/StartLivePopover";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.$templateId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { auditOrgAction } from "~/domain/org/audit.server";
import type { Prisma } from "~/db";
import {
  type ColumnDef,
  type DrillAudience,
  type TemplateDefinition,
  parseTemplateDefinition,
  seedRunStateFromTemplate,
} from "~/domain/drills/types";
import { ChecklistPreview } from "~/domain/drills/ChecklistTable";
import { startDrillRun } from "~/domain/drills/live.server";
import { parseIntent } from "~/lib/forms.server";
import { formClasses } from "~/lib/forms";
import { dataWithError, dataWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? (data?.template ? `Edit – ${data.template.name}` : "Edit checklist") },
];

// -----------------------------------------------------------------------------
// Shared zod schemas — drive both client-side (useAppForm) and server-side
// (parseIntent) validation. Phase 2 agents mirror this pattern in their routes.
// TODO: wire localized errorMap once Agent C ships `makeZodErrorMap`. Until
// then we keep messages keyed via `t()` resolved at use-site / build-site.
// -----------------------------------------------------------------------------

// English messages used as the static schema source. The action wraps these
// with translated dataWithError(...) toasts where it surfaces validation
// failures to the user.
// `autosave` is an optional flag the client sets on debounced background saves
// so the action can suppress the success toast (the editor shows a quiet inline
// "Saved" indicator instead). Absent on any explicit/manual submit.
const renameSchema = z.object({
  intent: z.literal("rename"),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  autosave: z.string().optional(),
});

const startLiveWithAudienceSchema = z.object({
  intent: z.literal("start-live"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]).default("EVERYONE"),
  // Mode default mirrors the column default. ACTUAL/FALSE_ALARM are explicit
  // per-event overrides; there is no template-level default.
  mode: z.enum(["DRILL", "ACTUAL", "FALSE_ALARM"]).default("DRILL"),
});

const setDefaultAudienceSchema = z.object({
  intent: z.literal("setDefaultAudience"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]),
  autosave: z.string().optional(),
});

const saveInstructionsSchema = z.object({
  intent: z.literal("saveInstructions"),
  instructions: z.string().max(8000, "Instructions are too long.").default(""),
  autosave: z.string().optional(),
});

// Cadence target. Empty input clears the column (no cadence tracking).
// Hard-cap at 365 because once-a-day is the most aggressive pattern that
// makes sense on a business-day-aware product; numbers above that are
// almost certainly typos that would make the "next due" math useless.
const setCadenceSchema = z.object({
  intent: z.literal("setCadence"),
  requiredPerYear: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(365)])
    .transform((v) => (v === "" ? null : v)),
  autosave: z.string().optional(),
});

const saveDefinitionSchema = zfd.formData({
  intent: zfd.text(z.literal("saveDefinition")),
  autosave: zfd.text(z.string().optional()),
  /** The template layout JSON — parsed and structurally validated. */
  definition: zfd.text(
    z
      .string()
      .min(2, "Definition is empty.")
      .transform((raw, ctx) => {
        try {
          const parsed = JSON.parse(raw) as Prisma.JsonValue;
          const def = parseTemplateDefinition(parsed);
          if (def.columns.filter((c) => c.kind === "toggle").length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Add at least one toggle column (e.g. Check).",
            });
            return z.NEVER;
          }
          return def;
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON." });
          return z.NEVER;
        }
      }),
  ),
});

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const id = params.templateId;
  if (!id) {
    throw new Response("Not found", { status: 404 });
  }
  // The template lookup, the classroom list (the data source for "selection"
  // columns), and the locale resolution share no data dependency, so run them
  // concurrently (one Prisma client per request makes this safe).
  const [template, classroomRows, locale] = await Promise.all([
    prisma.drillTemplate.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        definition: true,
        updatedAt: true,
        defaultAudience: true,
        requiredPerYear: true,
        instructions: true,
      },
    }),
    prisma.teacher.findMany({
      select: { homeRoom: true, teacherName: true },
      orderBy: [{ gradeLevel: "asc" }, { homeRoom: "asc" }],
    }),
    detectLocale(request, context),
  ]);
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }
  // Shape for the editor: each classroom's homeroom label + its teacher name
  // (so picking a homeroom can auto-fill a teacher column).
  const classrooms = classroomRows.map(
    (c: { homeRoom: string; teacherName: string | null }) => ({
      homeRoom: c.homeRoom,
      teacherName: c.teacherName ?? "",
    }),
  );
  const t = await getFixedT(locale, "admin");
  return { template, classrooms, metaTitle: t("drills.metaEdit", { name: template.name }) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const id = params.templateId;
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  if (!id) {
    return dataWithError(null, t("drills.edit.errors.missingTemplate"));
  }

  const result = await parseIntent(request, {
    rename: renameSchema,
    "start-live": startLiveWithAudienceSchema,
    setDefaultAudience: setDefaultAudienceSchema,
    saveDefinition: saveDefinitionSchema,
    setCadence: setCadenceSchema,
    saveInstructions: saveInstructionsSchema,
  });
  if (!result.success) return result.response;

  // Background autosaves return a quiet success (truthy, non-error data so the
  // editor's inline "Saved" indicator lights up) WITHOUT a toast. Explicit
  // submits (no `autosave` flag) keep the visible success toast.
  const saved = (msg: string) =>
    "autosave" in result.data && result.data.autosave
      ? data({ ok: true })
      : dataWithSuccess(null, msg);

  // Audit a template edit off the response path. `aspect` records which facet
  // changed (name / audience / layout / cadence / instructions) since the
  // payloads themselves can be large; like CloudTrail, every mutating save is
  // logged (including autosaves).
  const auditTpl = (aspect: string, extra?: Record<string, unknown>) =>
    auditOrgAction(context, request, {
      action: "drill.template.updated",
      targetType: "drillTemplate",
      targetId: id,
      always: true,
      payload: { aspect, ...extra },
    });

  try {
    if (result.intent === "rename") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { name: result.data.name },
      });
      await auditTpl("name", { name: result.data.name });
      return saved(t("drills.edit.toasts.nameSaved"));
    }

    if (result.intent === "setDefaultAudience") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { defaultAudience: result.data.audience },
      });
      await auditTpl("defaultAudience", { audience: result.data.audience });
      return saved(t("drills.edit.defaultAudience.saved"));
    }

    if (result.intent === "start-live") {
      const orgId = getOrgFromContext(context).id;
      const actor = getActorIdsFromContext(context);
      const tpl = await prisma.drillTemplate.findFirst({
        where: { id, deletedAt: null },
        select: { definition: true },
      });
      const initialState = tpl
        ? seedRunStateFromTemplate(parseTemplateDefinition(tpl.definition))
        : undefined;
      try {
        await startDrillRun(
          prisma,
          orgId,
          id,
          initialState,
          actor,
          result.data.audience,
          result.data.mode,
        );
      } catch (err) {
        // startDrillRun throws a Response (409) when another drill is already
        // active. Surface it as a toast instead of crashing the route.
        if (err instanceof Response && err.status === 409) {
          return dataWithError(null, t("drills.edit.errors.anotherLive"));
        }
        throw err;
      }
      throw redirect("/drills/live");
    }

    if (result.intent === "saveDefinition") {
      // result.data.definition is already a validated, normalized
      // TemplateDefinition because the zod transform ran it through
      // parseTemplateDefinition + the toggle-column invariant check.
      await prisma.drillTemplate.update({
        where: { id },
        data: { definition: result.data.definition as unknown as Prisma.InputJsonValue },
      });
      await auditTpl("definition");
      return saved(t("drills.edit.toasts.layoutSaved"));
    }

    if (result.intent === "setCadence") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { requiredPerYear: result.data.requiredPerYear },
      });
      await auditTpl("cadence", { requiredPerYear: result.data.requiredPerYear });
      return saved(t("drills.edit.cadence.saved"));
    }

    if (result.intent === "saveInstructions") {
      const trimmed = result.data.instructions.trim();
      await prisma.drillTemplate.update({
        where: { id },
        data: { instructions: trimmed.length > 0 ? trimmed : null },
      });
      await auditTpl("instructions");
      return saved(t("drills.edit.toasts.instructionsSaved"));
    }
  } catch (err) {
    // A redirect from start-live must propagate — React Router surfaces
    // Response throws itself. Everything else we turn into a toast so the
    // user sees WHAT failed rather than an opaque crash.
    if (err instanceof Response) throw err;
    // Always log the real error so wrangler tail shows the stack. Without
    // this we saw "save layout 500" with no clue — the catch swallowed
    // everything into a generic toast.
    console.error(
      `[drills.$templateId] action intent=${result.intent} template=${id} threw`,
      err,
    );
    const msg = err instanceof Error ? err.message : t("drills.edit.errors.unexpectedSave");
    return dataWithError(null, msg, { status: 500 });
  }

  return dataWithError(null, t("drills.edit.errors.unknown"));
}

function newId(): string {
  return crypto.randomUUID();
}

function cloneDefinition(def: TemplateDefinition): TemplateDefinition {
  const cloned: TemplateDefinition = {
    columns: def.columns.map((c) => ({
      ...c,
      ...(c.selectionSource ? { selectionSource: { ...c.selectionSource } } : {}),
    })),
    rows: def.rows.map((r) => {
      const row: typeof r = { id: r.id, cells: { ...r.cells } };
      if (r.sectionId !== undefined) row.sectionId = r.sectionId;
      if (r.overrides && r.overrides.length > 0) row.overrides = [...r.overrides];
      return row;
    }),
  };
  if (def.sections && def.sections.length > 0) {
    cloned.sections = def.sections.map((s) => ({ ...s }));
  }
  if (def.defaultActionItems && def.defaultActionItems.length > 0) {
    cloned.defaultActionItems = [...def.defaultActionItems];
  }
  return cloned;
}

// Debounce window for background autosaves — matches the live drill screen
// (`drills.live.tsx`) so the editor feels consistent.
const AUTOSAVE_DEBOUNCE_MS = 1000;

type SaveStatus = "idle" | "saving" | "saved";

/**
 * One self-contained autosave channel: a dedicated fetcher + a debounce timer.
 * `schedule(fd)` stamps the `autosave` flag and debounces the submit;
 * `flush()` fires any pending save immediately (used on blur / before leaving).
 * Each editable section gets its own instance so concurrent edits to different
 * fields never cancel each other's in-flight save.
 */
function useAutosaver() {
  const fetcher = useFetcher();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<FormData | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) {
      fetcher.submit(pending.current, { method: "post" });
      pending.current = null;
    }
  }, [fetcher]);

  const schedule = useCallback(
    (fd: FormData, delay = AUTOSAVE_DEBOUNCE_MS) => {
      fd.set("autosave", "1");
      pending.current = fd;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, delay);
    },
    [flush],
  );

  // Stamp "Saved" when a background save lands without error.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !("error" in (fetcher.data as object))) {
      setSavedAt(Date.now());
    }
  }, [fetcher.state, fetcher.data]);

  // Auto-clear the indicator after a moment.
  useEffect(() => {
    if (savedAt === null) return;
    const id = setTimeout(() => setSavedAt(null), 1500);
    return () => clearTimeout(id);
  }, [savedAt]);

  const status: SaveStatus =
    fetcher.state !== "idle" ? "saving" : savedAt !== null ? "saved" : "idle";

  return { schedule, flush, status };
}

export default function DrillTemplateEdit({ loaderData }: Route.ComponentProps) {
  const { template, classrooms } = loaderData;
  const { t } = useTranslation("admin");
  const [definition, setDefinition] = useState<TemplateDefinition>(() =>
    cloneDefinition(parseTemplateDefinition(template.definition)),
  );

  // Homeroom → teacher-name lookup, the data source for "selection" columns.
  const teacherByHomeroom = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classrooms) m.set(c.homeRoom, c.teacherName);
    return m;
  }, [classrooms]);
  // Column ids that are the auto-fill target of some selection column.
  const autoFillTargetIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of definition.columns) {
      if (c.kind === "selection" && c.selectionSource?.autoFillColumnId) {
        s.add(c.selectionSource.autoFillColumnId);
      }
    }
    return s;
  }, [definition.columns]);

  // One autosave channel per editable section.
  const nameSaver = useAutosaver();
  const audienceSaver = useAutosaver();
  const cadenceSaver = useAutosaver();
  const instructionsSaver = useAutosaver();
  const definitionSaver = useAutosaver();

  // Controlled field state (replaces the per-section Save buttons). Server-side
  // validation still runs via the zod schemas; the client gates obviously
  // invalid values so we don't fire doomed autosaves.
  const [name, setName] = useState(template.name);
  const [audience, setAudience] = useState<DrillAudience>(
    template.defaultAudience === "STAFF_ONLY" ? "STAFF_ONLY" : "EVERYONE",
  );
  const [cadence, setCadence] = useState(
    template.requiredPerYear != null ? String(template.requiredPerYear) : "",
  );
  const [instructions, setInstructions] = useState(template.instructions ?? "");

  // Tracks the last definition JSON we synced from the loader or autosaved, so
  // the autosave effect can tell a real user edit apart from a loader sync /
  // no-op re-render and skip redundant saves.
  const lastDefinitionJson = useRef(JSON.stringify(definition));

  // Re-sync local state when the loaded template changes (navigation, external
  // revalidation). Stamp lastDefinitionJson so the autosave effect won't echo
  // the sync straight back to the server.
  useEffect(() => {
    const synced = cloneDefinition(parseTemplateDefinition(template.definition));
    setDefinition(synced);
    lastDefinitionJson.current = JSON.stringify(synced);
    setName(template.name);
    setAudience(template.defaultAudience === "STAFF_ONLY" ? "STAFF_ONLY" : "EVERYONE");
    setCadence(template.requiredPerYear != null ? String(template.requiredPerYear) : "");
    setInstructions(template.instructions ?? "");
  }, [template.id, template.updatedAt, template.definition, template.name, template.defaultAudience, template.requiredPerYear, template.instructions]);

  // Autosave the layout/follow-up whenever the definition changes (debounced),
  // but never for loader syncs or while the structure is invalid (the server
  // rejects a definition with no toggle column, which would spam error toasts).
  useEffect(() => {
    const json = JSON.stringify(definition);
    if (json === lastDefinitionJson.current) return;
    lastDefinitionJson.current = json;
    const hasToggle = definition.columns.some((c) => c.kind === "toggle");
    if (!hasToggle) return;
    const fd = new FormData();
    fd.set("intent", "saveDefinition");
    fd.set("definition", json);
    definitionSaver.schedule(fd);
  }, [definition, definitionSaver]);

  const scheduleNameSave = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > 120) return;
      const fd = new FormData();
      fd.set("intent", "rename");
      fd.set("name", trimmed);
      nameSaver.schedule(fd);
    },
    [nameSaver],
  );

  const saveAudience = useCallback(
    (value: DrillAudience) => {
      const fd = new FormData();
      fd.set("intent", "setDefaultAudience");
      fd.set("audience", value);
      // Discrete choice — save right away rather than waiting out the debounce.
      audienceSaver.schedule(fd, 0);
      audienceSaver.flush();
    },
    [audienceSaver],
  );

  const scheduleCadenceSave = useCallback(
    (value: string) => {
      const n = Number(value);
      if (value !== "" && !(Number.isInteger(n) && n >= 1 && n <= 365)) return;
      const fd = new FormData();
      fd.set("intent", "setCadence");
      fd.set("requiredPerYear", value);
      cadenceSaver.schedule(fd);
    },
    [cadenceSaver],
  );

  const scheduleInstructionsSave = useCallback(
    (value: string) => {
      if (value.length > 8000) return;
      const fd = new FormData();
      fd.set("intent", "saveInstructions");
      fd.set("instructions", value);
      instructionsSaver.schedule(fd);
    },
    [instructionsSaver],
  );

  const flushAll = useCallback(() => {
    nameSaver.flush();
    audienceSaver.flush();
    cadenceSaver.flush();
    instructionsSaver.flush();
    definitionSaver.flush();
  }, [nameSaver, audienceSaver, cadenceSaver, instructionsSaver, definitionSaver]);

  // Flush pending debounced saves on unmount only. `flushAll` is recreated each
  // render (the savers return fresh objects), so we read the latest via a ref
  // and keep the effect's deps empty — otherwise the cleanup would fire on
  // every render and flush prematurely, defeating the debounce.
  const flushAllRef = useRef(flushAll);
  flushAllRef.current = flushAll;
  useEffect(() => () => flushAllRef.current(), []);

  const saveStatus: SaveStatus = [
    nameSaver.status,
    audienceSaver.status,
    cadenceSaver.status,
    instructionsSaver.status,
    definitionSaver.status,
  ].includes("saving")
    ? "saving"
    : [
          nameSaver.status,
          audienceSaver.status,
          cadenceSaver.status,
          instructionsSaver.status,
          definitionSaver.status,
        ].includes("saved")
      ? "saved"
      : "idle";

  const nameError = name.trim().length === 0;

  const updateColumn = useCallback((index: number, patch: Partial<ColumnDef>) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const prev = next.columns[index];
      if (!prev) return d;
      const merged = { ...prev, ...patch };
      next.columns[index] = merged;
      if (patch.kind && patch.kind !== prev.kind) {
        if (patch.kind === "toggle") {
          for (const row of next.rows) {
            delete row.cells[merged.id];
          }
        } else {
          // text + selection both carry a per-row string value.
          for (const row of next.rows) {
            row.cells[merged.id] = row.cells[merged.id] ?? "";
          }
        }
        // Manage the selection config alongside the kind.
        if (merged.kind === "selection") {
          merged.selectionSource = merged.selectionSource ?? { type: "classrooms" };
        } else {
          delete merged.selectionSource;
        }
      }
      return next;
    });
  }, []);

  const removeColumn = useCallback((index: number) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const [removed] = next.columns.splice(index, 1);
      if (!removed) return d;
      for (const row of next.rows) {
        delete row.cells[removed.id];
      }
      return next;
    });
  }, []);

  const moveColumn = useCallback((index: number, dir: -1 | 1) => {
    setDefinition((d) => {
      const j = index + dir;
      if (j < 0 || j >= d.columns.length) return d;
      const next = cloneDefinition(d);
      const tmp = next.columns[index];
      next.columns[index] = next.columns[j]!;
      next.columns[j] = tmp!;
      return next;
    });
  }, []);

  const addColumn = useCallback((kind: ColumnDef["kind"]) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const id = newId();
      const label = kind === "toggle" ? "Check" : kind === "selection" ? "Classroom" : "Column";
      const col: ColumnDef = { id, label, kind };
      if (kind === "selection") col.selectionSource = { type: "classrooms" };
      next.columns.push(col);
      if (kind === "text" || kind === "selection") {
        for (const row of next.rows) {
          row.cells[id] = "";
        }
      }
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const id = newId();
      const cells: Record<string, string> = {};
      for (const c of next.columns) {
        if (c.kind === "text" || c.kind === "selection") {
          cells[c.id] = "";
        }
      }
      next.rows.push({ id, cells });
      return next;
    });
  }, []);

  // Edit a text cell. When the cell is the auto-fill target of a selection
  // column, a manual edit marks it overridden so later selection changes won't
  // clobber the hand-typed value (and we can show an "overridden" badge).
  const updateRowCell = useCallback(
    (rowIndex: number, colId: string, value: string, isAutoFillTarget = false) => {
      setDefinition((d) => {
        const next = cloneDefinition(d);
        const row = next.rows[rowIndex];
        if (!row) return d;
        row.cells[colId] = value;
        if (isAutoFillTarget) {
          const set = new Set(row.overrides ?? []);
          set.add(colId);
          row.overrides = [...set];
        }
        return next;
      });
    },
    [],
  );

  // Pick a value in a selection cell. If the column auto-fills another column
  // and that target hasn't been manually overridden, fill it from the chosen
  // classroom's teacher name.
  const selectRowCell = useCallback(
    (rowIndex: number, col: ColumnDef, value: string) => {
      setDefinition((d) => {
        const next = cloneDefinition(d);
        const row = next.rows[rowIndex];
        if (!row) return d;
        row.cells[col.id] = value;
        const targetId = col.selectionSource?.autoFillColumnId;
        if (targetId && !(row.overrides ?? []).includes(targetId)) {
          row.cells[targetId] = teacherByHomeroom.get(value) ?? "";
        }
        return next;
      });
    },
    [teacherByHomeroom],
  );

  // Clear an override so the target cell re-links to its selection column and
  // refills from the current selection.
  const clearOverride = useCallback(
    (rowIndex: number, targetColId: string) => {
      setDefinition((d) => {
        const next = cloneDefinition(d);
        const row = next.rows[rowIndex];
        if (!row) return d;
        row.overrides = (row.overrides ?? []).filter((c) => c !== targetColId);
        if (row.overrides.length === 0) delete row.overrides;
        const selCol = next.columns.find(
          (c) => c.kind === "selection" && c.selectionSource?.autoFillColumnId === targetColId,
        );
        if (selCol) {
          row.cells[targetColId] = teacherByHomeroom.get(row.cells[selCol.id] ?? "") ?? "";
        }
        return next;
      });
    },
    [teacherByHomeroom],
  );

  const removeRow = useCallback((index: number) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      next.rows.splice(index, 1);
      return next;
    });
  }, []);

  const moveRow = useCallback((index: number, dir: -1 | 1) => {
    setDefinition((d) => {
      const j = index + dir;
      if (j < 0 || j >= d.rows.length) return d;
      const next = cloneDefinition(d);
      const tmp = next.rows[index];
      next.rows[index] = next.rows[j]!;
      next.rows[j] = tmp!;
      return next;
    });
  }, []);

  const addDefaultActionItem = useCallback(() => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      next.defaultActionItems = [...(next.defaultActionItems ?? []), ""];
      return next;
    });
  }, []);

  const updateDefaultActionItem = useCallback((index: number, value: string) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const items = [...(next.defaultActionItems ?? [])];
      items[index] = value;
      next.defaultActionItems = items;
      return next;
    });
  }, []);

  const removeDefaultActionItem = useCallback((index: number) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const items = [...(next.defaultActionItems ?? [])];
      items.splice(index, 1);
      if (items.length === 0) {
        delete next.defaultActionItems;
      } else {
        next.defaultActionItems = items;
      }
      return next;
    });
  }, []);

  return (
    <div className="p-6 xl:flex xl:items-start xl:gap-8">
      <div className="flex flex-col gap-6 max-w-[min(100%,56rem)] xl:flex-1 xl:min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/admin/drills"
          onClick={flushAll}
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("drills.edit.back")}
        </Link>
        <span className="ml-auto inline-flex items-center h-5 text-xs" aria-live="polite">
          {saveStatus === "saving" ? (
            <span className="text-white/50 inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse" />
              {t("drills.edit.autosave.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-300/80">{t("drills.edit.autosave.saved")}</span>
          ) : (
            <span className="text-white/30">{t("drills.edit.autosave.idle")}</span>
          )}
        </span>
      </div>

      <label className={`${formClasses.labelStack} flex-1 max-w-md`}>
        {t("drills.edit.templateName")}
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            scheduleNameSave(e.target.value);
          }}
          onBlur={() => nameSaver.flush()}
          className={formClasses.input}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "drill-name-error" : undefined}
        />
        {nameError ? (
          <span id="drill-name-error" className={formClasses.fieldError}>
            {t("drills.edit.errors.nameRequiredInline")}
          </span>
        ) : null}
      </label>

      <p className="text-xs text-white/40">
        {t("drills.edit.intro")}
      </p>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">
              {t("drills.edit.defaultAudience.heading")}
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              {t("drills.edit.defaultAudience.help")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 mt-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="audience"
              value="EVERYONE"
              checked={audience === "EVERYONE"}
              onChange={() => {
                setAudience("EVERYONE");
                saveAudience("EVERYONE");
              }}
            />
            <span>{t("drills.edit.defaultAudience.everyone")}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="audience"
              value="STAFF_ONLY"
              checked={audience === "STAFF_ONLY"}
              onChange={() => {
                setAudience("STAFF_ONLY");
                saveAudience("STAFF_ONLY");
              }}
            />
            <span>{t("drills.edit.defaultAudience.staffOnly")}</span>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">
              {t("drills.edit.cadence.heading")}
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              {t("drills.edit.cadence.help")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className={`${formClasses.labelStack} flex-1 min-w-[12rem] max-w-xs`}>
            {t("drills.edit.cadence.fieldLabel")}
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={cadence}
              onChange={(e) => {
                setCadence(e.target.value);
                scheduleCadenceSave(e.target.value);
              }}
              onBlur={() => cadenceSaver.flush()}
              placeholder={t("drills.edit.cadence.placeholder")}
              className={formClasses.input}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">
              {t("drills.edit.instructions.heading")}
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              {t("drills.edit.instructions.help")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 mt-3">
          <textarea
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              scheduleInstructionsSave(e.target.value);
            }}
            onBlur={() => instructionsSaver.flush()}
            rows={5}
            className="w-full app-field font-mono text-xs"
            placeholder={t("drills.edit.instructions.placeholder")}
          />
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-3">
          <ListChecks className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">
              {t("drills.edit.followUp.heading")}
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              {t("drills.edit.followUp.help")}
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-2 mt-3">
          {(definition.defaultActionItems ?? []).length === 0 ? (
            <li className="text-white/40 text-xs">{t("drills.edit.followUp.empty")}</li>
          ) : (
            (definition.defaultActionItems ?? []).map((item, index) => (
              <li key={index} className="flex items-center gap-2">
                <input
                  value={item}
                  onChange={(e) => updateDefaultActionItem(index, e.target.value)}
                  onBlur={() => definitionSaver.flush()}
                  className="flex-1 min-w-[12rem] app-field text-sm"
                  placeholder={t("drills.edit.followUp.itemPlaceholder")}
                  aria-label={t("drills.edit.followUp.itemLabel", { n: index + 1 })}
                />
                <button
                  type="button"
                  onClick={() => removeDefaultActionItem(index)}
                  className="p-2 text-rose-300 hover:bg-rose-500/10 rounded"
                  aria-label={t("drills.edit.followUp.removeItem")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={addDefaultActionItem}
            className={formClasses.btnSecondary}
          >
            <Plus className="w-4 h-4 mr-1 inline" />
            {t("drills.edit.followUp.addItem")}
          </button>
          <p className="text-xs text-white/40 self-center">
            {t("drills.edit.followUp.autosaveNote")}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("text")}>
          <Plus className="w-4 h-4 mr-1 inline" />
          {t("drills.edit.addText")}
        </button>
        <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("toggle")}>
          <Plus className="w-4 h-4 mr-1 inline" />
          {t("drills.edit.addToggle")}
        </button>
        <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("selection")}>
          <Plus className="w-4 h-4 mr-1 inline" />
          {t("drills.edit.addSelection")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-2 text-left text-white/50 font-medium w-10">#</th>
              {definition.columns.map((col, ci) => (
                <th key={col.id} className="px-2 py-2 text-left align-bottom">
                  <div className="flex flex-col gap-2 min-w-[120px]">
                    <input
                      value={col.label}
                      onChange={(e) => updateColumn(ci, { label: e.target.value })}
                      onBlur={() => definitionSaver.flush()}
                      className="app-field text-xs font-semibold"
                      aria-label={t("drills.edit.columnLabel", { n: ci + 1 })}
                    />
                    <select
                      value={col.kind}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateColumn(ci, {
                          kind: v === "toggle" ? "toggle" : v === "selection" ? "selection" : "text",
                        });
                      }}
                      className="app-field text-xs"
                    >
                      <option value="text">{t("drills.edit.kindText")}</option>
                      <option value="toggle">{t("drills.edit.kindToggle")}</option>
                      <option value="selection">{t("drills.edit.kindSelection")}</option>
                    </select>
                    {col.kind === "selection" ? (
                      <select
                        value={col.selectionSource?.autoFillColumnId ?? ""}
                        onChange={(e) =>
                          updateColumn(ci, {
                            selectionSource: {
                              type: "classrooms",
                              autoFillColumnId: e.target.value || undefined,
                            },
                          })
                        }
                        onBlur={() => definitionSaver.flush()}
                        className="app-field text-xs"
                        aria-label={t("drills.edit.autofillColumnLabel")}
                      >
                        <option value="">{t("drills.edit.autofillNone")}</option>
                        {definition.columns
                          .filter((c) => c.kind === "text")
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {t("drills.edit.autofillInto", { label: c.label })}
                            </option>
                          ))}
                      </select>
                    ) : null}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                        onClick={() => moveColumn(ci, -1)}
                        aria-label={t("drills.edit.moveLeft")}
                      >
                        <ArrowUp className="w-3 h-3 -rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                        onClick={() => moveColumn(ci, 1)}
                        aria-label={t("drills.edit.moveRight")}
                      >
                        <ArrowDown className="w-3 h-3 -rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 ml-auto"
                        onClick={() => removeColumn(ci)}
                        aria-label={t("drills.edit.removeColumn")}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {definition.rows.map((row, ri) => (
              <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-2 py-2 text-white/40 text-xs align-middle">{ri + 1}</td>
                {definition.columns.map((col) => (
                  <td key={col.id} className="px-2 py-2 align-middle">
                    {col.kind === "selection" ? (
                      <select
                        value={row.cells[col.id] ?? ""}
                        onChange={(e) => selectRowCell(ri, col, e.target.value)}
                        onBlur={() => definitionSaver.flush()}
                        className="w-full min-w-[6rem] app-field"
                        aria-label={t("drills.edit.selectClassroom")}
                      >
                        <option value="">{t("drills.edit.selectClassroom")}</option>
                        {classrooms.map((c: { homeRoom: string; teacherName: string }) => (
                          <option key={c.homeRoom} value={c.homeRoom}>
                            {c.homeRoom}
                          </option>
                        ))}
                      </select>
                    ) : col.kind === "text" ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={row.cells[col.id] ?? ""}
                          onChange={(e) =>
                            updateRowCell(ri, col.id, e.target.value, autoFillTargetIds.has(col.id))
                          }
                          onBlur={() => definitionSaver.flush()}
                          className="w-full min-w-[6rem] app-field"
                        />
                        {autoFillTargetIds.has(col.id) &&
                        (row.overrides ?? []).includes(col.id) ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-300/80">
                            {t("drills.edit.overridden")}
                            <button
                              type="button"
                              className="underline hover:text-amber-200"
                              onClick={() => clearOverride(ri, col.id)}
                            >
                              {t("drills.edit.resetAutofill")}
                            </button>
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-white/30 text-xs">{t("drills.edit.checkOnRun")}</span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 align-middle">
                  <div className="flex gap-1 justify-end">
                    <button
                      type="button"
                      className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                      onClick={() => moveRow(ri, -1)}
                      aria-label={t("drills.edit.moveUp")}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                      onClick={() => moveRow(ri, 1)}
                      aria-label={t("drills.edit.moveDown")}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                      onClick={() => removeRow(ri)}
                      aria-label={t("drills.edit.removeRow")}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" className={`${formClasses.btnSecondary} self-start`} onClick={addRow}>
        <Plus className="w-4 h-4 mr-1 inline" />
        {t("drills.edit.addRow")}
      </button>

      <div className="flex flex-wrap gap-3">
        <StartLivePopover
          templateId={template.id}
          templateName={template.name}
          defaultAudience={(template.defaultAudience ?? "EVERYONE") as DrillAudience}
        />
        <Link
          to={`/admin/drills/${template.id}/run`}
          onClick={flushAll}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          {t("drills.edit.openRun")}
        </Link>
        <Link
          to={`/admin/print/drills/${template.id}`}
          className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
          target="_blank"
          rel="noreferrer"
        >
          {t("drills.edit.printPreview")}
        </Link>
      </div>
      </div>

      <aside className="hidden xl:block xl:w-[28rem] xl:flex-shrink-0 mt-6 xl:mt-0">
        <div className="sticky top-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Eye className="w-4 h-4" />
            <span className="font-medium">{t("drills.edit.livePreview")}</span>
          </div>
          <ChecklistPreview definition={definition} />
          <p className="text-xs text-white/40">
            {t("drills.edit.previewHelp")}
          </p>
        </div>
      </aside>
    </div>
  );
}
