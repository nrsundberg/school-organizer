import { Link } from "react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.history.$runId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  isDrillRunStatus,
  parseRunState,
  parseTemplateDefinition,
  type DrillRunStatus,
} from "~/domain/drills/types";
import { ChecklistTable } from "~/domain/drills/ChecklistTable";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import { formatDurationSeconds } from "./drills.history";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title:
      data?.metaTitle ??
      (data?.template ? `Replay – ${data.template.name}` : "Drill replay"),
  },
];

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const runId = params.runId;
  if (!runId) {
    throw new Response("Not found", { status: 404 });
  }

  // Belt-and-braces: the tenant extension already scopes by orgId, but check
  // explicitly so a misconfigured extension can't leak another tenant's runs.
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId: org.id },
    include: { template: true },
  });
  if (!run) {
    throw new Response("Not found", { status: 404 });
  }

  const status: DrillRunStatus = isDrillRunStatus(run.status)
    ? run.status
    : "ENDED";

  const start = run.activatedAt ?? run.createdAt;
  const end = run.endedAt ?? null;
  const durationSeconds = end
    ? Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 1000),
      )
    : null;

  // Latest-run check so we only show the "Print" link when the print page
  // (which always renders the most recent run for the template) matches the
  // run we're viewing.
  const latest = await prisma.drillRun.findFirst({
    where: { templateId: run.templateId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const isLatestForTemplate = latest?.id === run.id;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  return {
    metaTitle: t("drillsHistory.replay.metaTitle", { name: run.template.name }),
    template: {
      id: run.template.id,
      name: run.template.name,
      definition: run.template.definition,
    },
    run: {
      id: run.id,
      status,
      state: run.state,
      startedIso: start.toISOString(),
      endedIso: end ? end.toISOString() : null,
      durationSeconds,
      lastActorUserId: run.lastActorUserId,
    },
    isLatestForTemplate,
  };
}

function StatusChip({ status }: { status: DrillRunStatus }) {
  const { t } = useTranslation("admin");
  const cls =
    status === "LIVE"
      ? "bg-rose-600/20 text-rose-200 border border-rose-500/40"
      : status === "PAUSED"
        ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
        : status === "ENDED"
          ? "bg-emerald-600/20 text-emerald-200 border border-emerald-500/40"
          : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status === "LIVE" && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"
        />
      )}
      {t(`drillsHistory.status.${status}`)}
    </span>
  );
}

export default function AdminDrillsHistoryReplay({
  loaderData,
}: Route.ComponentProps) {
  const { template, run, isLatestForTemplate } = loaderData;
  const { t, i18n } = useTranslation("admin");

  const definition = parseTemplateDefinition(template.definition);
  const state = parseRunState(run.state);

  const startedFmt = new Date(run.startedIso).toLocaleString(i18n.language);
  const durationFmt = formatDurationSeconds(run.durationSeconds);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[min(100%,56rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin/drills/history"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("drillsHistory.replay.back")}
        </Link>
        {isLatestForTemplate && (
          <Link
            to={`/admin/print/drills/${template.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
          >
            <Printer className="w-4 h-4" />
            {t("drillsHistory.replay.print")}
          </Link>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{template.name}</h1>
          <StatusChip status={run.status} />
        </div>
        <p className="text-white/50 text-sm mt-1">
          {t("drillsHistory.replay.subhead", {
            started: startedFmt,
            duration: durationFmt,
          })}
        </p>
        {run.lastActorUserId && (
          <p className="text-white/40 text-xs mt-1">
            {t("drillsHistory.replay.lastActor", {
              actor: run.lastActorUserId,
            })}
          </p>
        )}
      </div>

      {/* Reuse the run-screen ChecklistTable in readOnly mode. The presentational
          component already supports that prop, so we don't need a duplicate
          read-only view (and the edit page keeps its existing edit-write path). */}
      <ChecklistTable
        definition={definition}
        state={state}
        onToggle={() => {
          /* read-only — no-op */
        }}
        readOnly
      />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">
          {t("drillsHistory.replay.notesHeading")}
        </h2>
        {state.notes.trim() === "" ? (
          <p className="text-white/40 text-sm">
            {t("drillsHistory.replay.noNotes")}
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-white/90">
            {state.notes}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">
          {t("drillsHistory.replay.followUpHeading")}
        </h2>
        {state.actionItems.length === 0 ? (
          <p className="text-white/40 text-sm">
            {t("drillsHistory.replay.noItems")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.actionItems.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                {/*
                  Read-only checklist: render as a disabled checkbox so the
                  semantics ("done / not done") survive screen readers without
                  any chance of accidental input. The label sits in plain text
                  next to it for parity with the run screen's checked list.
                */}
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled
                  aria-label={
                    item.done
                      ? t("drillsHistory.replay.actionDone")
                      : t("drillsHistory.replay.actionPending")
                  }
                  className="h-4 w-4 rounded border-white/20 bg-white/5"
                />
                <span
                  className={
                    item.done
                      ? "text-white/60 line-through"
                      : "text-white"
                  }
                >
                  {item.text || (
                    <span className="text-white/30 italic">
                      {t("drillsHistory.replay.actionEmpty")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
