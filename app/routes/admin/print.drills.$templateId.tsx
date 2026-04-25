// Print route — DO NOT use the user's UI locale for translations.
// The drill printout is for staff use during/after a drill (same audience
// as master roster), so it follows `org.defaultLocale`. We reuse the
// `usePrintLocale("master")` rule for that reason; the loader resolves
// the locale via `getOrgDefaultLocale` and the component pins
// `useTranslation("admin", { lng: printLocale })`.

import { useEffect } from "react";
import { Link } from "react-router";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/print.drills.$templateId";
import { requireRole } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
  emptyRunState,
} from "~/domain/drills/types";
import { getOrgDefaultLocale } from "~/i18n.server";
import { usePrintLocale } from "~/hooks/usePrintLocale";

export const handle = { i18n: ["admin"] };

export async function loader({ context, params }: Route.LoaderArgs) {
  await requireRole(context, "ADMIN");
  const prisma = getTenantPrisma(context);
  const templateId = params.templateId;
  if (!templateId) {
    throw new Response("Not found", { status: 404 });
  }
  const template = await prisma.drillTemplate.findFirst({
    where: { id: templateId },
    select: { id: true, name: true, definition: true },
  });
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }
  // Migration 0021 dropped the unique-on-templateId constraint (see
  // admin/drills.$templateId.run.tsx for the same treatment) — use findFirst
  // ordered by updatedAt to get the most recent run.
  const run = await prisma.drillRun.findFirst({
    where: { templateId },
    orderBy: { updatedAt: "desc" },
    select: { state: true },
  });
  const state = run ? parseRunState(run.state) : emptyRunState();
  const printLocale = getOrgDefaultLocale(context);
  return { template, state, printLocale };
}

export default function PrintDrill({ loaderData }: Route.ComponentProps) {
  const { template, state } = loaderData;
  // Drill prints share the master-roster audience; reuse that rule.
  const printLocale = usePrintLocale("master");
  const { t } = useTranslation("admin", { lng: printLocale });
  const definition = parseTemplateDefinition(template.definition);

  useEffect(() => {
    const tm = setTimeout(() => window.print(), 400);
    return () => clearTimeout(tm);
  }, []);

  const pageCss = `@page { size: letter portrait; margin: 0.4in; }
    html, body { height: 100%; margin: 0; }
    #root, #root > * { min-height: 100%; }`;

  return (
    <>
      <title>{t("drills.print.title", { name: template.name })}</title>
      <style>{pageCss}</style>
      <div lang={printLocale} className="p-4 text-black bg-white font-sans min-h-screen print:p-0">
        <div className="flex items-baseline justify-between mb-4 print:mb-3">
          <h1 className="text-xl font-semibold">{template.name}</h1>
          <Link
            to={`/admin/drills/${template.id}/run`}
            className="text-sm text-blue-600 hover:underline print:hidden"
          >
            {t("drills.print.back")}
          </Link>
        </div>

        <table className="w-full border-collapse border border-neutral-400 text-sm mb-6">
          <thead>
            <tr>
              {definition.columns.map((col) => (
                <th
                  key={col.id}
                  className="border border-neutral-400 px-2 py-2 text-left font-semibold bg-neutral-100"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {definition.rows.map((row) => (
              <tr key={row.id}>
                {definition.columns.map((col) => (
                  <td key={col.id} className="border border-neutral-400 px-2 py-2 align-middle">
                    {col.kind === "text" ? (
                      row.cells[col.id] ?? ""
                    ) : (() => {
                      // Tri-state print rendering. A naive truthy check would
                      // render the same green check for "positive" AND
                      // "negative" (both are truthy strings). Branch on the
                      // explicit value so the printout matches what the
                      // teacher clicked.
                      const val = state.toggles[toggleKey(row.id, col.id)];
                      if (val === "positive") {
                        return (
                          <span className="inline-flex items-center justify-center text-emerald-700 font-semibold gap-1">
                            <Check className="w-4 h-4" /> {t("drills.print.yes")}
                          </span>
                        );
                      }
                      if (val === "negative") {
                        return (
                          <span className="inline-flex items-center justify-center text-rose-700 font-semibold gap-1">
                            <X className="w-4 h-4" /> {t("drills.print.no")}
                          </span>
                        );
                      }
                      return <span className="text-neutral-300">—</span>;
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide border-b border-neutral-400 pb-1 mb-2">{t("drills.print.notesHeading")}</h2>
          <p className="whitespace-pre-wrap text-sm min-h-[4rem] border border-neutral-300 rounded p-2 bg-neutral-50">
            {state.notes || " "}
          </p>
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide border-b border-neutral-400 pb-1 mb-2">
            {t("drills.print.followUpHeading")}
          </h2>
          {state.actionItems.length === 0 ? (
            <p className="text-sm text-neutral-400">{t("drills.print.none")}</p>
          ) : (
            <ul className="text-sm space-y-1">
              {state.actionItems.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span className="font-mono text-neutral-500">{item.done ? "☑" : "☐"}</span>
                  <span className={item.done ? "line-through text-neutral-500" : ""}>{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
