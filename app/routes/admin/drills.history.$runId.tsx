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
  emptyRunState,
  isDrillRunStatus,
  parseDrillAudience,
  parseDrillEventPayload,
  parseRunState,
  parseTemplateDefinition,
  type DrillAudience,
  type DrillRunStatus,
  type RunState,
} from "~/domain/drills/types";
import { synthesizeLifecycleEvents } from "~/domain/drills/replay";
import { ChecklistTable } from "~/domain/drills/ChecklistTable";
import { ReplayTimeline } from "~/domain/drills/ReplayTimeline";
import { ReplayEventFeed } from "~/domain/drills/ReplayEventFeed";
import {
  useDrillReplay,
  type ReplayEvent,
} from "~/domain/drills/useDrillReplay";
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
    ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
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

  // Pull every event for this run, plus the unique users who acted on it, so
  // the replay feed can show names instead of raw IDs.
  const rawEvents = await prisma.drillRunEvent.findMany({
    where: { runId },
    orderBy: { occurredAt: "asc" },
  });

  const actorIds = [
    ...new Set(
      rawEvents.flatMap((e) =>
        [e.actorUserId, e.onBehalfOfUserId].filter(
          (v): v is string => !!v,
        ),
      ),
    ),
  ];
  if (run.lastActorUserId && !actorIds.includes(run.lastActorUserId)) {
    actorIds.push(run.lastActorUserId);
  }
  const actorRows = actorIds.length
    ? ((await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      })) as Array<{ id: string; name: string }>)
    : [];
  const actorById = new Map(actorRows.map((u) => [u.id, u]));

  function resolveActor(id: string | null | undefined) {
    if (!id) return null;
    const row = actorById.get(id);
    const name = row?.name && row.name.trim() !== "" ? row.name : id;
    return { id, name };
  }

  const events: ReplayEvent[] = [];
  for (const e of rawEvents) {
    const payload = parseDrillEventPayload(e.kind, e.payload);
    if (!payload) continue;
    events.push({
      id: e.id,
      kind: payload.kind,
      payload,
      occurredAt: e.occurredAt.toISOString(),
      actor: resolveActor(e.actorUserId),
      onBehalfOf: resolveActor(e.onBehalfOfUserId),
    });
  }

  // Initial state: prefer the started event's snapshot; otherwise fall back to
  // synthesized lifecycle events keyed off run timestamps.
  let initialState: RunState = emptyRunState();
  const startedEvent = events.find((e) => e.kind === "started");
  if (startedEvent && startedEvent.payload.kind === "started") {
    initialState = startedEvent.payload.initialState;
  } else if (events.length === 0) {
    const synthesized = synthesizeLifecycleEvents({
      activatedAt: run.activatedAt,
      pausedAt: run.pausedAt,
      endedAt: run.endedAt,
    });
    for (const s of synthesized) {
      events.push({
        id: `synth-${s.kind}-${s.occurredAt.getTime()}`,
        kind: s.kind,
        payload: s.payload,
        occurredAt: s.occurredAt.toISOString(),
        actor: null,
        onBehalfOf: null,
      });
    }
  }

  const lastActor = resolveActor(run.lastActorUserId);

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
      audience: parseDrillAudience(run.audience),
      state: run.state,
      startedIso: start.toISOString(),
      endedIso: end ? end.toISOString() : null,
      durationSeconds,
      lastActorUserId: run.lastActorUserId,
    },
    events,
    initialState,
    lastActor,
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

function AudienceChip({ audience }: { audience: DrillAudience }) {
  const { t } = useTranslation("admin");
  const cls =
    audience === "STAFF_ONLY"
      ? "bg-blue-500/20 text-blue-200 border border-blue-500/40"
      : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {audience === "STAFF_ONLY"
        ? t("drillsHistory.replay.audience.staffOnly")
        : t("drillsHistory.replay.audience.everyone")}
    </span>
  );
}

export default function AdminDrillsHistoryReplay({
  loaderData,
}: Route.ComponentProps) {
  const { template, run, isLatestForTemplate, events, initialState, lastActor } =
    loaderData;
  const { t, i18n } = useTranslation("admin");

  const definition = parseTemplateDefinition(template.definition);
  const finalState = parseRunState(run.state);

  const startedFmt = new Date(run.startedIso).toLocaleString(i18n.language);
  const durationFmt = formatDurationSeconds(run.durationSeconds);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[min(100%,72rem)]">
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
          <AudienceChip audience={run.audience} />
        </div>
        <p className="text-white/50 text-sm mt-1">
          {t("drillsHistory.replay.subhead", {
            started: startedFmt,
            duration: durationFmt,
          })}
        </p>
        {lastActor && (
          <p className="text-white/40 text-xs mt-1">
            {t("drillsHistory.replay.lastActor", { actor: lastActor.name })}
          </p>
        )}
      </div>

      {run.status === "ENDED" ? (
        <ReplayLayout
          definition={definition}
          events={events}
          initialState={initialState}
          startedIso={run.startedIso}
          endedIso={run.endedIso ?? run.startedIso}
        />
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
            {t("drillsHistory.replay.liveRunNotice")}
          </div>
          <StaticReplayBody definition={definition} state={finalState} />
        </>
      )}
    </div>
  );
}

function ReplayLayout({
  definition,
  events,
  initialState,
  startedIso,
  endedIso,
}: {
  definition: ReturnType<typeof parseTemplateDefinition>;
  events: ReplayEvent[];
  initialState: RunState;
  startedIso: string;
  endedIso: string;
}) {
  const { t } = useTranslation("admin");
  const replay = useDrillReplay({
    initialState,
    events,
    startedAtIso: startedIso,
    endedAtIso: endedIso,
  });

  return (
    <>
      <ReplayTimeline
        startedAtIso={startedIso}
        endedAtIso={endedIso}
        events={events}
        currentTimeMs={replay.currentTimeMs}
        totalDurationMs={replay.totalDurationMs}
        isPlaying={replay.isPlaying}
        speed={replay.speed}
        onSeek={replay.seek}
        onPlayToggle={() => (replay.isPlaying ? replay.pause() : replay.play())}
        onSpeedChange={replay.setSpeed}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ChecklistTable
            definition={definition}
            state={replay.replayState}
            onToggle={() => {
              /* read-only — no-op */
            }}
            readOnly
          />

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-2">
              {t("drillsHistory.replay.notesHeading")}
            </h2>
            {replay.replayState.notes.trim() === "" ? (
              <p className="text-white/40 text-sm">
                {t("drillsHistory.replay.noNotes")}
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-white/90">
                {replay.replayState.notes}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">
              {t("drillsHistory.replay.followUpHeading")}
            </h2>
            {replay.replayState.actionItems.length === 0 ? (
              <p className="text-white/40 text-sm">
                {t("drillsHistory.replay.noItems")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {replay.replayState.actionItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
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

        <div className="lg:col-span-1">
          <ReplayEventFeed
            events={events}
            currentEventIndex={replay.currentEventIndex}
            startedAtIso={startedIso}
            onSeek={replay.seek}
          />
        </div>
      </div>
    </>
  );
}

function StaticReplayBody({
  definition,
  state,
}: {
  definition: ReturnType<typeof parseTemplateDefinition>;
  state: RunState;
}) {
  const { t } = useTranslation("admin");
  return (
    <>
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
                    item.done ? "text-white/60 line-through" : "text-white"
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
    </>
  );
}
