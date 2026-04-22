import { Form, Link, redirect } from "react-router";
import { ArrowLeft, Check, Library } from "lucide-react";
import type { Route } from "./+types/drills.library";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { GLOBAL_TEMPLATES, getGlobalTemplate } from "~/domain/drills/library";
import { DRILL_TYPE_LABELS, type DrillType } from "~/domain/drills/types";
import { cloneGlobalTemplateToOrg } from "~/domain/drills/clone.server";
import { dataWithError } from "remix-toast";

export const meta: Route.MetaFunction = () => [{ title: "Admin – Drill template library" }];

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50";

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const cloned = await prisma.drillTemplate.findMany({
    where: { globalKey: { not: null } },
    select: { globalKey: true, id: true },
  });
  // Map of globalKey -> orgTemplateId so the UI can deep-link "Already cloned".
  const clonedByKey: Record<string, string> = {};
  for (const row of cloned) {
    if (row.globalKey) {
      clonedByKey[row.globalKey] = row.id;
    }
  }
  return { templates: GLOBAL_TEMPLATES, clonedByKey };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const orgId = getOrgFromContext(context).id;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "clone") {
    const globalKey = String(formData.get("globalKey") ?? "").trim();
    if (!globalKey) {
      return dataWithError(null, "Missing template key.");
    }
    const source = getGlobalTemplate(globalKey);
    if (!source) {
      throw new Response("Template not found in library.", { status: 404 });
    }
    const existing = await prisma.drillTemplate.findFirst({
      where: { globalKey },
      select: { id: true },
    });
    if (existing) {
      return dataWithError(null, "Already cloned — it's in your templates list.");
    }
    const created = await cloneGlobalTemplateToOrg(prisma, orgId, globalKey);
    throw redirect(`/admin/drills/${created.id}`);
  }

  return dataWithError(null, "Unknown action.");
}

interface CardTemplate {
  globalKey: string;
  name: string;
  drillType: DrillType;
  authority: string;
  description: string;
  instructions: string;
  rowCount: number;
  sectionCount: number;
  instructionsPeek: string;
}

function summarize(t: (typeof GLOBAL_TEMPLATES)[number]): CardTemplate {
  const rows = t.definition.rows ?? [];
  const sections = t.definition.sections ?? [];
  // Strip markdown emphasis + take first non-empty paragraph for the peek.
  const firstPara =
    t.instructions
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? "";
  const peek = firstPara.replace(/\*\*/g, "").replace(/\*/g, "");
  return {
    globalKey: t.globalKey,
    name: t.name,
    drillType: t.drillType,
    authority: t.authority,
    description: t.description,
    instructions: t.instructions,
    rowCount: rows.length,
    sectionCount: sections.length,
    instructionsPeek: peek,
  };
}

export default function AdminDrillLibrary({ loaderData }: Route.ComponentProps) {
  const { templates, clonedByKey } = loaderData;

  // Group by DrillType, preserving the canonical label-map order.
  const grouped = new Map<DrillType, CardTemplate[]>();
  for (const t of templates) {
    const list = grouped.get(t.drillType) ?? [];
    list.push(summarize(t));
    grouped.set(t.drillType, list);
  }
  const orderedGroups = (Object.keys(DRILL_TYPE_LABELS) as DrillType[])
    .filter((dt) => grouped.has(dt))
    .map((dt) => ({ drillType: dt, items: grouped.get(dt)! }));

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="flex items-start gap-3">
          <Library className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-white">Drill template library</h1>
            <p className="text-white/50 text-sm mt-1">
              Pre-built templates aligned to NFPA, SRP v4.2, FEMA, NWS, and other safety
              standards. Clone one to make it editable in your org.
            </p>
          </div>
        </div>
        <Link to="/admin/drills" className={btnSecondary}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5 inline" />
          Back to checklists
        </Link>
      </div>

      {orderedGroups.map(({ drillType, items }) => (
        <section key={drillType}>
          <h2 className="text-sm font-semibold text-white/70 mb-3 uppercase tracking-wider">
            {DRILL_TYPE_LABELS[drillType]}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((t) => {
              const clonedId = clonedByKey[t.globalKey];
              const stepLabel = `${t.rowCount} step${t.rowCount === 1 ? "" : "s"}`;
              const sectionLabel =
                t.sectionCount > 0
                  ? ` · ${t.sectionCount} section${t.sectionCount === 1 ? "" : "s"}`
                  : "";
              return (
                <article
                  key={t.globalKey}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <header className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{t.name}</h3>
                      <span className="inline-flex items-center rounded-md bg-blue-500/15 text-blue-300 text-xs font-medium px-2 py-0.5">
                        {DRILL_TYPE_LABELS[t.drillType]}
                      </span>
                    </div>
                    <p className="text-xs text-white/40">{t.authority}</p>
                  </header>

                  <p className="text-sm text-white/70">{t.description}</p>

                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p
                      className="text-xs text-white/50 line-clamp-2"
                      title={t.instructionsPeek}
                    >
                      {t.instructionsPeek}
                    </p>
                    <p className="text-[11px] text-white/40 mt-2">
                      {stepLabel}
                      {sectionLabel}
                    </p>
                  </div>

                  <div className="mt-auto pt-2">
                    {clonedId ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center text-xs text-emerald-300">
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Already cloned
                        </span>
                        <Link to={`/admin/drills/${clonedId}`} className={btnSecondary}>
                          Open your copy
                        </Link>
                      </div>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="clone" />
                        <input type="hidden" name="globalKey" value={t.globalKey} />
                        <button type="submit" className={`${btnPrimary} w-full`}>
                          Clone to my templates
                        </button>
                      </Form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
