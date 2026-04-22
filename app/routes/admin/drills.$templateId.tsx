import { Form, Link, redirect, useFetcher } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Plus, Radio, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getFormProps, getInputProps } from "@conform-to/react";
import type { Route } from "./+types/drills.$templateId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import type { Prisma } from "~/db";
import { type ColumnDef, type TemplateDefinition, parseTemplateDefinition } from "~/domain/drills/types";
import { ChecklistPreview } from "~/domain/drills/ChecklistTable";
import { startDrillRun } from "~/domain/drills/live.server";
import { parseIntent } from "~/lib/forms.server";
import { formClasses, getFieldError, useAppForm } from "~/lib/forms";
import { dataWithError, dataWithSuccess } from "remix-toast";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.template ? `Edit – ${data.template.name}` : "Edit checklist" },
];

// -----------------------------------------------------------------------------
// Shared zod schemas — drive both client-side (useAppForm) and server-side
// (parseIntent) validation. Phase 2 agents mirror this pattern in their routes.
// -----------------------------------------------------------------------------

const renameSchema = z.object({
  intent: z.literal("rename"),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
});

const startLiveSchema = z.object({
  intent: z.literal("start-live"),
});

const saveDefinitionSchema = zfd.formData({
  intent: zfd.text(z.literal("saveDefinition")),
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

export async function loader({ context, params }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const id = params.templateId;
  if (!id) {
    throw new Response("Not found", { status: 404 });
  }
  const template = await prisma.drillTemplate.findFirst({
    where: { id },
    select: { id: true, name: true, definition: true, updatedAt: true },
  });
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }
  return { template };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const id = params.templateId;
  if (!id) {
    return dataWithError(null, "Missing template.");
  }

  const result = await parseIntent(request, {
    rename: renameSchema,
    "start-live": startLiveSchema,
    saveDefinition: saveDefinitionSchema,
  });
  if (!result.success) return result.response;

  try {
    if (result.intent === "rename") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { name: result.data.name },
      });
      return dataWithSuccess(null, "Name saved.");
    }

    if (result.intent === "start-live") {
      const orgId = getOrgFromContext(context).id;
      try {
        await startDrillRun(prisma, orgId, id);
      } catch (err) {
        // startDrillRun throws a Response (409) when another drill is already
        // active. Surface it as a toast instead of crashing the route.
        if (err instanceof Response && err.status === 409) {
          return dataWithError(null, "Another drill is already live. End it first.");
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
      return dataWithSuccess(null, "Layout saved.");
    }
  } catch (err) {
    // A redirect from start-live must propagate — React Router surfaces
    // Response throws itself. Everything else we turn into a toast so the
    // user sees WHAT failed rather than an opaque crash (this was the
    // "unexpected server error" on Save layout).
    if (err instanceof Response) throw err;
    const msg = err instanceof Error ? err.message : "Unexpected error saving.";
    return dataWithError(null, msg, { status: 500 });
  }

  return dataWithError(null, "Unknown action.");
}

function newId(): string {
  return crypto.randomUUID();
}

function cloneDefinition(def: TemplateDefinition): TemplateDefinition {
  return {
    columns: def.columns.map((c) => ({ ...c })),
    rows: def.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
  };
}

export default function DrillTemplateEdit({ loaderData }: Route.ComponentProps) {
  const { template } = loaderData;
  const [definition, setDefinition] = useState<TemplateDefinition>(() =>
    cloneDefinition(parseTemplateDefinition(template.definition)),
  );
  const saveFetcher = useFetcher();
  const liveFetcher = useFetcher();

  // Conform-managed rename form. `useAppForm` wires up zod validation + the
  // action's `lastResult` automatically. We keep the intent as a hidden input
  // so the same action signature works for progressive enhancement.
  const [renameForm, renameFields] = useAppForm(renameSchema, {
    id: `rename-${template.id}`,
    defaultValue: { intent: "rename", name: template.name },
  });

  useEffect(() => {
    setDefinition(cloneDefinition(parseTemplateDefinition(template.definition)));
  }, [template.id, template.updatedAt, template.definition]);

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
          for (const row of next.rows) {
            row.cells[merged.id] = row.cells[merged.id] ?? "";
          }
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
      const label = kind === "toggle" ? "Check" : "Column";
      next.columns.push({ id, label, kind });
      if (kind === "text") {
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
        if (c.kind === "text") {
          cells[c.id] = "";
        }
      }
      next.rows.push({ id, cells });
      return next;
    });
  }, []);

  const updateRowCell = useCallback((rowIndex: number, colId: string, value: string) => {
    setDefinition((d) => {
      const next = cloneDefinition(d);
      const row = next.rows[rowIndex];
      if (!row) return d;
      row.cells[colId] = value;
      return next;
    });
  }, []);

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

  const saveDefinition = () => {
    const fd = new FormData();
    fd.set("intent", "saveDefinition");
    fd.set("definition", JSON.stringify(definition));
    saveFetcher.submit(fd, { method: "post" });
  };

  const renameError = getFieldError(renameFields.name);

  return (
    <div className="p-6 xl:flex xl:items-start xl:gap-8">
      <div className="flex flex-col gap-6 max-w-[min(100%,56rem)] xl:flex-1 xl:min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/admin/drills"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All checklists
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4 justify-between">
        <Form
          method="post"
          {...getFormProps(renameForm)}
          className="flex flex-wrap items-end gap-3 flex-1 min-w-[240px]"
        >
          <input type="hidden" name="intent" value="rename" />
          <label className={`${formClasses.labelStack} flex-1 max-w-md`}>
            Template name
            <input
              {...getInputProps(renameFields.name, { type: "text" })}
              key={template.updatedAt.toISOString()}
              defaultValue={template.name}
              className={formClasses.input}
              aria-invalid={renameError ? true : undefined}
              aria-describedby={renameError ? `${renameFields.name.id}-error` : undefined}
            />
            {renameError ? (
              <span id={`${renameFields.name.id}-error`} className={formClasses.fieldError}>
                {renameError}
              </span>
            ) : null}
          </label>
          <button type="submit" className={formClasses.btnSecondary}>
            Save name
          </button>
        </Form>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("text")}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Text column
          </button>
          <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("toggle")}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Toggle column
          </button>
          <button
            type="button"
            className={formClasses.btnPrimary}
            onClick={saveDefinition}
            disabled={saveFetcher.state !== "idle"}
          >
            {saveFetcher.state !== "idle" ? "Saving…" : "Save layout"}
          </button>
        </div>
      </div>

      <p className="text-xs text-white/40">
        Toggle columns show a check on the run screen. Text columns store labels (grade, teacher name, etc.).
      </p>

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
                      className="rounded border border-white/20 bg-white/5 px-2 py-1 text-white text-xs font-semibold"
                      aria-label={`Column ${ci + 1} label`}
                    />
                    <select
                      value={col.kind}
                      onChange={(e) =>
                        updateColumn(ci, { kind: e.target.value === "toggle" ? "toggle" : "text" })
                      }
                      className="rounded border border-white/20 bg-[#1a1f1f] px-2 py-1 text-white text-xs"
                    >
                      <option value="text">Text</option>
                      <option value="toggle">Toggle</option>
                    </select>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                        onClick={() => moveColumn(ci, -1)}
                        aria-label="Move column left"
                      >
                        <ArrowUp className="w-3 h-3 -rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                        onClick={() => moveColumn(ci, 1)}
                        aria-label="Move column right"
                      >
                        <ArrowDown className="w-3 h-3 -rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 ml-auto"
                        onClick={() => removeColumn(ci)}
                        aria-label="Remove column"
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
                    {col.kind === "text" ? (
                      <input
                        value={row.cells[col.id] ?? ""}
                        onChange={(e) => updateRowCell(ri, col.id, e.target.value)}
                        className="w-full min-w-[6rem] rounded border border-white/15 bg-white/5 px-2 py-1.5 text-white"
                      />
                    ) : (
                      <span className="text-white/30 text-xs">check on run</span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 align-middle">
                  <div className="flex gap-1 justify-end">
                    <button
                      type="button"
                      className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                      onClick={() => moveRow(ri, -1)}
                      aria-label="Move row up"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded border border-white/10 text-white/60 hover:bg-white/10"
                      onClick={() => moveRow(ri, 1)}
                      aria-label="Move row down"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                      onClick={() => removeRow(ri)}
                      aria-label="Remove row"
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
        Add row
      </button>

      <div className="flex flex-wrap gap-3">
        <liveFetcher.Form method="post">
          <input type="hidden" name="intent" value="start-live" />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
            disabled={liveFetcher.state !== "idle"}
          >
            <Radio className="w-4 h-4" />
            Start live drill
          </button>
        </liveFetcher.Form>
        <Link
          to={`/admin/drills/${template.id}/run`}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          Open run screen
        </Link>
        <Link
          to={`/admin/print/drills/${template.id}`}
          className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
          target="_blank"
          rel="noreferrer"
        >
          Print preview
        </Link>
      </div>
      </div>

      <aside className="hidden xl:block xl:w-[28rem] xl:flex-shrink-0 mt-6 xl:mt-0">
        <div className="sticky top-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Eye className="w-4 h-4" />
            <span className="font-medium">Live preview</span>
          </div>
          <ChecklistPreview definition={definition} />
          <p className="text-xs text-white/40">
            What teachers see on the run screen. Updates as you edit — save to persist.
          </p>
        </div>
      </aside>
    </div>
  );
}
