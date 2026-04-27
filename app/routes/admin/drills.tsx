import { Form, Link, redirect } from "react-router";
import { ClipboardList, History, Library, Radio, StopCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  defaultTemplateDefinition,
  parseDrillAudience,
  parseDrillMode,
  parseTemplateDefinition,
  seedRunStateFromTemplate,
  isDrillRunStatus,
  type DrillAudience,
  type DrillRunStatus,
} from "~/domain/drills/types";
import { StartLivePopover } from "~/domain/drills/StartLivePopover";
import { endDrillRun, startDrillRun } from "~/domain/drills/live.server";
import { computeCadenceStatus, type CadenceStatus } from "~/domain/drills/cadence";
import { dataWithError, dataWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Drill checklists" },
];

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50";
const btnGhostDanger =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/10 transition-colors";

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [templates, activeRunRow] = await Promise.all([
    prisma.drillTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        defaultAudience: true,
        requiredPerYear: true,
      },
    }),
    prisma.drillRun.findFirst({
      where: { status: { in: ["LIVE", "PAUSED"] } },
      orderBy: { activatedAt: "desc" },
      select: {
        id: true,
        status: true,
        audience: true,
        activatedAt: true,
        createdAt: true,
        template: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Compute "next due / overdue" per template that has a cadence configured.
  // We pull the most recent ENDED run per template — `findFirst` with desc
  // order is a single query per template; with the typical N=10–20 templates
  // this is fine. If we ever exceed that, switch to a single GROUP BY query.
  const now = new Date();
  const cadenceById = new Map<string, CadenceStatus>();
  for (const tpl of templates) {
    if (tpl.requiredPerYear == null) {
      cadenceById.set(tpl.id, { state: "none" });
      continue;
    }
    const lastEnded = await prisma.drillRun.findFirst({
      where: { templateId: tpl.id, status: "ENDED" },
      orderBy: { endedAt: "desc" },
      select: { endedAt: true },
    });
    cadenceById.set(
      tpl.id,
      computeCadenceStatus(tpl.requiredPerYear, lastEnded?.endedAt ?? null, now),
    );
  }
  const templatesWithCadence = templates.map((tpl) => ({
    ...tpl,
    cadence: cadenceById.get(tpl.id) ?? ({ state: "none" } as CadenceStatus),
  }));

  const activeRun = activeRunRow
    ? {
        id: activeRunRow.id,
        status: (isDrillRunStatus(activeRunRow.status)
          ? activeRunRow.status
          : "LIVE") as DrillRunStatus,
        audience: parseDrillAudience(activeRunRow.audience),
        startedIso: (
          activeRunRow.activatedAt ?? activeRunRow.createdAt
        ).toISOString(),
        templateId: activeRunRow.template?.id ?? null,
        templateName: activeRunRow.template?.name ?? "(deleted template)",
      }
    : null;
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    templates: templatesWithCadence,
    activeRun,
    metaTitle: t("drills.metaList"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return dataWithError(null, t("drills.list.errors.nameRequired"));
    }
    const orgId = getOrgFromContext(context).id;
    const created = await prisma.drillTemplate.create({
      data: {
        orgId,
        name,
        definition: defaultTemplateDefinition() as object,
      },
    });
    throw redirect(`/admin/drills/${created.id}`);
  }

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    await prisma.drillTemplate.delete({ where: { id } });
    return dataWithSuccess(null, t("drills.list.errors.deleted"));
  }

  // "Run" on the list page now *starts a live drill* instead of opening the
  // edit-and-run screen — matches the red "Start live drill" button on the
  // edit page. We keep the flow in one place (startDrillRun) so the unique
  // "at most one live drill per org" invariant surfaces the same 409 toast.
  if (intent === "start-live") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    const audience = parseDrillAudience(formData.get("audience"));
    const mode = parseDrillMode(formData.get("mode"));
    const orgId = getOrgFromContext(context).id;
    const actor = getActorIdsFromContext(context);
    const tpl = await prisma.drillTemplate.findFirst({
      where: { id },
      select: { definition: true },
    });
    const initialState = tpl
      ? seedRunStateFromTemplate(parseTemplateDefinition(tpl.definition))
      : undefined;
    try {
      await startDrillRun(prisma, orgId, id, initialState, actor, audience, mode);
    } catch (err) {
      if (err instanceof Response && err.status === 409) {
        return dataWithError(null, t("drills.list.errors.anotherLive"));
      }
      console.error("[drills.list] start-live failed", err);
      throw err;
    }
    throw redirect("/drills/live");
  }

  if (intent === "end-active") {
    const runId = String(formData.get("runId") ?? "");
    if (!runId) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    const orgId = getOrgFromContext(context).id;
    const actor = getActorIdsFromContext(context);
    try {
      await endDrillRun(prisma, orgId, runId, actor);
    } catch (err) {
      if (err instanceof Response && (err.status === 404 || err.status === 409)) {
        // Stale UI: someone else already ended it. Surface a soft success so
        // the admin lands on a consistent "no active drill" state.
        return dataWithSuccess(null, t("drills.list.activeBanner.endedToast"));
      }
      throw err;
    }
    return dataWithSuccess(null, t("drills.list.activeBanner.endedToast"));
  }

  return dataWithError(null, t("drills.list.errors.unknown"));
}


export default function AdminDrillList({ loaderData }: Route.ComponentProps) {
  const { templates, activeRun } = loaderData;
  const { t, i18n } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <ClipboardList className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t("drills.list.heading")}</h1>
          <p className="text-white/50 text-sm mt-1">
            {t("drills.list.subtitle")}
          </p>
        </div>
      </div>

      {activeRun && (
        <section
          className={
            activeRun.status === "PAUSED"
              ? "rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
              : "rounded-xl border border-rose-500/40 bg-rose-500/10 p-4"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Radio
                className={
                  activeRun.status === "PAUSED"
                    ? "w-6 h-6 text-amber-300 flex-shrink-0 mt-0.5"
                    : "w-6 h-6 text-rose-300 flex-shrink-0 mt-0.5 animate-pulse"
                }
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      activeRun.status === "PAUSED"
                        ? "inline-flex items-center rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        : "inline-flex items-center rounded-full bg-rose-600/20 text-rose-200 border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    }
                  >
                    {t(`drillsHistory.status.${activeRun.status}`)}
                  </span>
                  <span
                    className={
                      activeRun.audience === "STAFF_ONLY"
                        ? "inline-flex items-center rounded-full bg-blue-500/20 text-blue-200 border border-blue-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        : "inline-flex items-center rounded-full bg-white/10 text-white/70 border border-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    }
                  >
                    {activeRun.audience === "STAFF_ONLY"
                      ? t("drillsHistory.replay.audience.staffOnly")
                      : t("drillsHistory.replay.audience.everyone")}
                  </span>
                  <h2 className="text-base font-semibold text-white">
                    {activeRun.templateName}
                  </h2>
                </div>
                <p className="text-xs text-white/60 mt-1">
                  {t("drills.list.activeBanner.startedAt", {
                    when: new Date(activeRun.startedIso).toLocaleString(
                      i18n.language,
                    ),
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/drills/live" className={btnSecondary}>
                {t("drills.list.activeBanner.openLive")}
              </Link>
              <Form
                method="post"
                onSubmit={(e) =>
                  !confirm(t("drills.list.activeBanner.confirmEnd")) &&
                  e.preventDefault()
                }
              >
                <input type="hidden" name="intent" value="end-active" />
                <input type="hidden" name="runId" value={activeRun.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  {t("drills.list.activeBanner.endDrill")}
                </button>
              </Form>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-white/70">{t("drills.list.newHeading")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/drills/history"
              className={`${btnSecondary} text-xs`}
            >
              <History className="w-3.5 h-3.5 mr-1.5 inline" />
              {t("drills.list.viewHistory")}
            </Link>
            <Link
              to="/admin/drills/library"
              className={`${btnSecondary} text-xs`}
            >
              <Library className="w-3.5 h-3.5 mr-1.5 inline" />
              {t("drills.list.startFromLibrary")}
            </Link>
          </div>
        </div>
        <Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="intent" value="create" />
          <label className="text-sm text-white/60 flex flex-col gap-1 flex-1 min-w-[200px]">
            {t("drills.list.nameLabel")}
            <input
              name="name"
              type="text"
              required
              placeholder={t("drills.list.namePlaceholder")}
              className="app-field"
            />
          </label>
          <button type="submit" className={btnPrimary}>
            {t("drills.list.createBlank")}
          </button>
        </Form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white/70 mb-3">{t("drills.list.yourTemplates")}</h2>
        {templates.length === 0 ? (
          <p className="text-white/40 text-sm">{t("drills.list.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/admin/drills/${tpl.id}`}
                      className="font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {tpl.name}
                    </Link>
                    {tpl.cadence.state === "overdue" ? (
                      <span
                        className="inline-flex items-center rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[11px] font-medium text-rose-200"
                        title={t("drills.list.cadence.overdueTitle")}
                      >
                        {t("drills.list.cadence.overdue", { days: tpl.cadence.days ?? 0 })}
                      </span>
                    ) : tpl.cadence.state === "due" ? (
                      <span
                        className="inline-flex items-center rounded-full bg-white/5 border border-white/15 px-2 py-0.5 text-[11px] font-medium text-white/60"
                        title={t("drills.list.cadence.dueTitle")}
                      >
                        {t("drills.list.cadence.dueIn", { days: tpl.cadence.days ?? 0 })}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">
                    {t("drills.list.updated", {
                      when: new Date(tpl.updatedAt).toLocaleString(i18n.language),
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StartLivePopover
                    templateId={tpl.id}
                    templateName={tpl.name}
                    defaultAudience={(tpl.defaultAudience ?? "EVERYONE") as DrillAudience}
                  />
                  <Link
                    to={`/admin/drills/${tpl.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    {t("drills.list.editLayout")}
                  </Link>
                  <Form method="post" onSubmit={(e) => !confirm(t("drills.list.confirmDelete")) && e.preventDefault()}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={tpl.id} />
                    <button type="submit" className={btnGhostDanger}>
                      {t("drills.list.delete")}
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
