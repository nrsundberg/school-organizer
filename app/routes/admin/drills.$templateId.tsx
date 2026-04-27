import { Form, Link, redirect, useFetcher } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Plus, Trash2, Users } from "lucide-react";
import { StartLivePopover } from "~/domain/drills/StartLivePopover";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getFormProps, getInputProps } from "@conform-to/react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.$templateId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import type { Prisma } from "~/db";
import { type ColumnDef, type DrillAudience, type TemplateDefinition, parseTemplateDefinition } from "~/domain/drills/types";
import { ChecklistPreview } from "~/domain/drills/ChecklistTable";
import { startDrillRun } from "~/domain/drills/live.server";
import { parseIntent } from "~/lib/forms.server";
import { formClasses, getFieldError, useAppForm } from "~/lib/forms";
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
const renameSchema = z.object({
  intent: z.literal("rename"),
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
});

const startLiveWithAudienceSchema = z.object({
  intent: z.literal("start-live"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]).default("EVERYONE"),
});

const setDefaultAudienceSchema = z.object({
  intent: z.literal("setDefaultAudience"),
  audience: z.enum(["STAFF_ONLY", "EVERYONE"]),
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

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const id = params.templateId;
  if (!id) {
    throw new Response("Not found", { status: 404 });
  }
  const template = await prisma.drillTemplate.findFirst({
    where: { id },
    select: { id: true, name: true, definition: true, updatedAt: true, defaultAudience: true },
  });
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return { template, metaTitle: t("drills.metaEdit", { name: template.name }) };
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
  });
  if (!result.success) return result.response;

  try {
    if (result.intent === "rename") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { name: result.data.name },
      });
      return dataWithSuccess(null, t("drills.edit.toasts.nameSaved"));
    }

    if (result.intent === "setDefaultAudience") {
      await prisma.drillTemplate.update({
        where: { id },
        data: { defaultAudience: result.data.audience },
      });
      return dataWithSuccess(null, t("drills.edit.defaultAudience.saved"));
    }

    if (result.intent === "start-live") {
      const orgId = getOrgFromContext(context).id;
      const actor = getActorIdsFromContext(context);
      try {
        await startDrillRun(
          prisma,
          orgId,
          id,
          undefined,
          actor,
          result.data.audience,
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
      return dataWithSuccess(null, t("drills.edit.toasts.layoutSaved"));
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
  return {
    columns: def.columns.map((c) => ({ ...c })),
    rows: def.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
  };
}

export default function DrillTemplateEdit({ loaderData }: Route.ComponentProps) {
  const { template } = loaderData;
  const { t } = useTranslation("admin");
  const [definition, setDefinition] = useState<TemplateDefinition>(() =>
    cloneDefinition(parseTemplateDefinition(template.definition)),
  );
  const saveFetcher = useFetcher();

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
          {t("drills.edit.back")}
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
            {t("drills.edit.templateName")}
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
            {t("drills.edit.saveName")}
          </button>
        </Form>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("text")}>
            <Plus className="w-4 h-4 mr-1 inline" />
            {t("drills.edit.addText")}
          </button>
          <button type="button" className={formClasses.btnSecondary} onClick={() => addColumn("toggle")}>
            <Plus className="w-4 h-4 mr-1 inline" />
            {t("drills.edit.addToggle")}
          </button>
          <button
            type="button"
            className={formClasses.btnPrimary}
            onClick={saveDefinition}
            disabled={saveFetcher.state !== "idle"}
          >
            {saveFetcher.state !== "idle" ? t("drills.edit.saving") : t("drills.edit.saveLayout")}
          </button>
        </div>
      </div>

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
        <Form method="post" className="flex flex-col gap-2 mt-3">
          <input type="hidden" name="intent" value="setDefaultAudience" />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="audience"
              value="EVERYONE"
              defaultChecked={template.defaultAudience !== "STAFF_ONLY"}
            />
            <span>{t("drills.edit.defaultAudience.everyone")}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="audience"
              value="STAFF_ONLY"
              defaultChecked={template.defaultAudience === "STAFF_ONLY"}
            />
            <span>{t("drills.edit.defaultAudience.staffOnly")}</span>
          </label>
          <button
            type="submit"
            className={`${formClasses.btnSecondary} self-start mt-2`}
          >
            {t("drills.edit.defaultAudience.saveButton")}
          </button>
        </Form>
      </section>

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
                      className="app-field text-xs font-semibold"
                      aria-label={t("drills.edit.columnLabel", { n: ci + 1 })}
                    />
                    <select
                      value={col.kind}
                      onChange={(e) =>
                        updateColumn(ci, { kind: e.target.value === "toggle" ? "toggle" : "text" })
                      }
                      className="app-field text-xs"
                    >
                      <option value="text">{t("drills.edit.kindText")}</option>
                      <option value="toggle">{t("drills.edit.kindToggle")}</option>
                    </select>
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
                    {col.kind === "text" ? (
                      <input
                        value={row.cells[col.id] ?? ""}
                        onChange={(e) => updateRowCell(ri, col.id, e.target.value)}
                        className="w-full min-w-[6rem] app-field"
                      />
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
