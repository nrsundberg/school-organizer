import { Form, Link, redirect } from "react-router";
import { ArrowLeft, Check, Library } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.library";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { GLOBAL_TEMPLATES, getGlobalTemplate } from "~/domain/drills/library";
import { DRILL_TYPE_LABELS, type DrillType } from "~/domain/drills/types";
import { cloneGlobalTemplateToOrg } from "~/domain/drills/clone.server";
import { dataWithError } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Drill template library" },
];

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50";

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [cloned, teacherCount] = await Promise.all([
    prisma.drillTemplate.findMany({
      where: { globalKey: { not: null } },
      select: { globalKey: true, id: true },
    }),
    prisma.teacher.count(),
  ]);
  // Map of globalKey -> orgTemplateId so the UI can deep-link "Already cloned".
  const clonedByKey: Record<string, string> = {};
  for (const row of cloned) {
    if (row.globalKey) {
      clonedByKey[row.globalKey] = row.id;
    }
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    templates: GLOBAL_TEMPLATES,
    clonedByKey,
    teacherCount,
    metaTitle: t("drills.metaLibrary"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const orgId = getOrgFromContext(context).id;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (intent === "clone") {
    const globalKey = String(formData.get("globalKey") ?? "").trim();
    if (!globalKey) {
      return dataWithError(null, t("drills.library.errors.missingKey"));
    }
    const source = getGlobalTemplate(globalKey);
    if (!source) {
      throw new Response(t("drills.library.errors.notFound"), { status: 404 });
    }
    const existing = await prisma.drillTemplate.findFirst({
      where: { globalKey },
      select: { id: true },
    });
    if (existing) {
      return dataWithError(null, t("drills.library.errors.alreadyCloned"));
    }
    const created = await cloneGlobalTemplateToOrg(prisma, orgId, globalKey);
    throw redirect(`/admin/drills/${created.id}`);
  }

  return dataWithError(null, t("drills.library.errors.unknown"));
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
  /** True when this template's class-roll rows would be replaced with the org's teachers on clone. */
  hasClassRoll: boolean;
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
  // Class-roll detection mirrors clone.server.ts: a Teacher column AND
  // either no sections at all or a section literally named "class-roll".
  const hasTeacherCol = t.definition.columns.some(
    (c) => c.id === "teacher" || c.label.trim().toLowerCase() === "teacher",
  );
  const hasClassRollSection =
    !sections.length || sections.some((s) => s.id === "class-roll");
  const hasClassRoll = hasTeacherCol && hasClassRollSection;
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
    hasClassRoll,
  };
}

export default function AdminDrillLibrary({ loaderData }: Route.ComponentProps) {
  const { templates, clonedByKey, teacherCount } = loaderData;
  const { t } = useTranslation("admin");

  // Group by DrillType, preserving the canonical label-map order.
  const grouped = new Map<DrillType, CardTemplate[]>();
  for (const tpl of templates) {
    const list = grouped.get(tpl.drillType) ?? [];
    list.push(summarize(tpl));
    grouped.set(tpl.drillType, list);
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
            <h1 className="text-2xl font-bold text-white">{t("drills.library.heading")}</h1>
            <p className="text-white/50 text-sm mt-1">
              {t("drills.library.subtitle")}
            </p>
          </div>
        </div>
        <Link to="/admin/drills" className={btnSecondary}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5 inline" />
          {t("drills.library.back")}
        </Link>
      </div>

      {orderedGroups.map(({ drillType, items }) => (
        <section key={drillType}>
          <h2 className="text-sm font-semibold text-white/70 mb-3 uppercase tracking-wider">
            {DRILL_TYPE_LABELS[drillType]}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((tpl) => {
              const clonedId = clonedByKey[tpl.globalKey];
              const stepLabel = t("drills.library.step", { count: tpl.rowCount });
              const sectionLabel =
                tpl.sectionCount > 0
                  ? t("drills.library.section", { count: tpl.sectionCount })
                  : "";
              return (
                <article
                  key={tpl.globalKey}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <header className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{tpl.name}</h3>
                      <span className="inline-flex items-center rounded-md bg-blue-500/15 text-blue-300 text-xs font-medium px-2 py-0.5">
                        {DRILL_TYPE_LABELS[tpl.drillType]}
                      </span>
                    </div>
                    <p className="text-xs text-white/40">{tpl.authority}</p>
                  </header>

                  <p className="text-sm text-white/70">{tpl.description}</p>

                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p
                      className="text-xs text-white/50 line-clamp-2"
                      title={tpl.instructionsPeek}
                    >
                      {tpl.instructionsPeek}
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
                          {t("drills.library.alreadyCloned")}
                        </span>
                        <Link to={`/admin/drills/${clonedId}`} className={btnSecondary}>
                          {t("drills.library.openCopy")}
                        </Link>
                      </div>
                    ) : (
                      <Form method="post" className="flex flex-col gap-1.5">
                        <input type="hidden" name="intent" value="clone" />
                        <input type="hidden" name="globalKey" value={tpl.globalKey} />
                        <button type="submit" className={`${btnPrimary} w-full`}>
                          {t("drills.library.clone")}
                        </button>
                        {tpl.hasClassRoll && teacherCount > 0 ? (
                          <p className="text-[11px] text-white/40 text-center">
                            {t("drills.library.teacherFanoutHint", {
                              count: teacherCount,
                            })}
                          </p>
                        ) : null}
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
