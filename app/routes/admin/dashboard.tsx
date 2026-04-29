import { Form, Link, useFetcher } from "react-router";
import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eraser,
  FileSpreadsheet,
  Hand,
  Home,
  Pencil,
  Printer,
  Users as UsersIcon,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Status } from "~/db/browser";
import { protectToAdminAndGetPermissions, requireRole } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  buildUsageSnapshot,
  countOrgUsage,
  type UsageSnapshot,
} from "~/domain/billing/plan-usage.server";
import { MinimalCsvFileChooser } from "~/components/FileChooser";
import { StatCard } from "~/components/admin/StatCard";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { StatusPill } from "~/components/admin/StatusPill";
import { formatActorLabel } from "~/domain/auth/format-actor";
import type { Route } from "./+types/dashboard";
import {
  dataWithError,
  dataWithInfo,
  dataWithSuccess,
  dataWithWarning,
} from "remix-toast";
import { broadcastBoardReset } from "~/lib/broadcast.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin Dashboard" },
];

// --- Date helpers (UTC, mirrors households.tsx so "today" semantics line up
// across admin pages) -------------------------------------------------------
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}
function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

/**
 * Returns true if the given exception is "active today" — either a DATE row
 * matching today's UTC day or a WEEKLY row whose `dayOfWeek` matches today
 * and whose optional starts/ends window contains today. Mirrors the helper
 * in households.tsx so the dashboard stat agrees with the households index.
 */
function exceptionActiveOn(
  exception: {
    scheduleKind: string;
    exceptionDate: Date | null;
    dayOfWeek: number | null;
    startsOn: Date | null;
    endsOn: Date | null;
  },
  today: Date,
): boolean {
  const dayStart = startOfUtcDay(today);
  if (exception.scheduleKind === "DATE") {
    if (!exception.exceptionDate) return false;
    return (
      startOfUtcDay(exception.exceptionDate).getTime() === dayStart.getTime()
    );
  }
  if (exception.dayOfWeek == null) return false;
  if (today.getUTCDay() !== exception.dayOfWeek) return false;
  if (
    exception.startsOn &&
    dayStart.getTime() < startOfUtcDay(exception.startsOn).getTime()
  ) {
    return false;
  }
  if (
    exception.endsOn &&
    dayStart.getTime() > startOfUtcDay(exception.endsOn).getTime()
  ) {
    return false;
  }
  return true;
}

// --- Activity feed --------------------------------------------------------
type ActivityItem = {
  id: string;
  kind: "drill" | "audit" | "boardReset";
  occurredAt: string; // ISO
  actorLabel: string | null;
  onBehalfOfLabel: string | null;
  primary: string;
  secondary?: string;
  href?: string;
};

function humanizeAuditAction(action: string, t: TFunction): string {
  const fallback = action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
  return t(`dashboard.auditActions.${action}`, { defaultValue: fallback });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const todayEnd = endOfUtcDay(now);

  // AppSettings.lastBoardResetAt is read via raw D1 because the type-generated
  // Prisma client might be a build behind the schema in CI. Keeping this raw
  // also matches the existing pattern used by the `clear` action which writes
  // via raw D1.
  const d1 = (context as any).cloudflare.env.D1_DATABASE as D1Database;
  const settingsRowPromise = d1
    .prepare(
      'SELECT "viewerDrawingEnabled", "lastBoardResetAt" FROM "AppSettings" WHERE "orgId" = ?',
    )
    .bind(org.id)
    .first<{
      viewerDrawingEnabled: number | boolean;
      lastBoardResetAt: string | null;
    }>();

  const [
    studentCount,
    spaceCount,
    activeSpaceCount,
    pickupsToday,
    householdCount,
    activeExceptionsRaw,
    recentDrillRuns,
    recentAuditLogs,
    maxSpace,
    teachers,
    counts,
    settingsRow,
  ] = await Promise.all([
    prisma.student.count(),
    prisma.space.count(),
    prisma.space.count({ where: { status: Status.ACTIVE } }),
    prisma.callEvent.count({
      where: { createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.household.count(),
    prisma.dismissalException.findMany({
      where: { isActive: true },
      select: {
        id: true,
        scheduleKind: true,
        exceptionDate: true,
        dayOfWeek: true,
        startsOn: true,
        endsOn: true,
      },
    }),
    prisma.drillRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        mode: true,
        createdAt: true,
        activatedAt: true,
        endedAt: true,
        template: { select: { id: true, name: true } },
      },
    }),
    prisma.orgAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        actorUserId: true,
        onBehalfOfUserId: true,
        createdAt: true,
      },
    }),
    prisma.space.aggregate({ _max: { spaceNumber: true } }),
    prisma.teacher.findMany({ orderBy: { homeRoom: "asc" } }),
    countOrgUsage(prisma, org.id),
    settingsRowPromise,
  ]);

  const usage = buildUsageSnapshot(org, counts, now);
  const activeExceptionsToday = activeExceptionsRaw.filter((e) =>
    exceptionActiveOn(e, now),
  ).length;

  // Resolve user names for the activity feed in one batched query so we can
  // render "Alice via Bob" labels without N+1 lookups.
  const userIds = new Set<string>();
  for (const log of recentAuditLogs) {
    if (log.actorUserId) userIds.add(log.actorUserId);
    if (log.onBehalfOfUserId) userIds.add(log.onBehalfOfUserId);
  }
  const userMap = userIds.size
    ? new Map(
        (
          await prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name?.trim() || null] as const),
      )
    : new Map<string, string | null>();

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  const activity: ActivityItem[] = [];

  // Drill runs: each LIVE/PAUSED/ENDED run is one item. The activatedAt is
  // the most user-meaningful timestamp ("the drill started at"), falling
  // back to createdAt for DRAFTs.
  for (const run of recentDrillRuns) {
    const occurredAt =
      run.endedAt ?? run.activatedAt ?? run.createdAt;
    const occurredIso =
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : (occurredAt as unknown as string);
    activity.push({
      id: `drill-${run.id}`,
      kind: "drill",
      occurredAt: occurredIso,
      actorLabel: null,
      onBehalfOfLabel: null,
      primary: `${run.template?.name ?? "Drill"} — ${run.status.toLowerCase()}`,
      secondary: run.mode !== "DRILL" ? run.mode.toLowerCase() : undefined,
      href: `/admin/drills/history/${run.id}`,
    });
  }
  for (const log of recentAuditLogs) {
    activity.push({
      id: `audit-${log.id}`,
      kind: "audit",
      occurredAt:
        log.createdAt instanceof Date
          ? log.createdAt.toISOString()
          : (log.createdAt as unknown as string),
      actorLabel: log.actorUserId
        ? userMap.get(log.actorUserId) ?? null
        : null,
      onBehalfOfLabel: log.onBehalfOfUserId
        ? userMap.get(log.onBehalfOfUserId) ?? null
        : null,
      primary: humanizeAuditAction(log.action, t),
    });
  }

  activity.sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : -1));
  const recentActivity = activity.slice(0, 8);

  const lastBoardResetAt = settingsRow?.lastBoardResetAt ?? null;
  const boardResetToday = lastBoardResetAt
    ? new Date(lastBoardResetAt).getTime() >= todayStart.getTime()
    : false;

  return {
    metaTitle: t("dashboard.metaTitle"),
    studentCount,
    spaceCount,
    activeSpaceCount,
    pickupsToday,
    householdCount,
    activeExceptionsToday,
    lastBoardResetAt,
    boardResetToday,
    recentActivity,
    viewerDrawingEnabled: !!settingsRow?.viewerDrawingEnabled,
    isAdmin: me.role === "ADMIN",
    maxSpaceNumber: maxSpace._max.spaceNumber ?? 0,
    teachers,
    usage,
    billingPlan: org.billingPlan,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (action === "create") {
    const raw = formData.get("gridSize") as string;
    const gridSize = Math.min(
      5000,
      Math.max(1, parseInt(raw || "300", 10) || 300),
    );
    const data = [];
    for (let i = 1; i <= gridSize; i++) {
      data.push({ spaceNumber: i, status: Status.EMPTY });
    }
    await prisma.space.deleteMany();
    for (let i = 0; i < data.length; i += 50) {
      await prisma.space.createMany({ data: data.slice(i, i + 50) });
    }
    return dataWithSuccess(null, t("dashboard.actions.createdGrid", { n: gridSize }));
  }

  if (action === "extendGrid") {
    const target = Math.min(
      5000,
      Math.max(1, parseInt((formData.get("extendTo") as string) || "0", 10)),
    );
    const maxRow = await prisma.space.aggregate({ _max: { spaceNumber: true } });
    const currentMax = maxRow._max.spaceNumber ?? 0;
    if (target <= currentMax) {
      return dataWithError(null, t("dashboard.actions.extendError"));
    }
    const batch = [];
    for (let i = currentMax + 1; i <= target; i++) {
      batch.push({ spaceNumber: i, status: Status.EMPTY });
    }
    for (let i = 0; i < batch.length; i += 50) {
      await prisma.space.createMany({ data: batch.slice(i, i + 50) });
    }
    return dataWithSuccess(
      null,
      t("dashboard.actions.addedSpaces", { from: currentMax + 1, to: target }),
    );
  }

  if (action === "reduceGrid") {
    const target = Math.min(
      5000,
      Math.max(1, parseInt((formData.get("reduceTo") as string) || "0", 10)),
    );
    const maxRow = await prisma.space.aggregate({ _max: { spaceNumber: true } });
    const currentMax = maxRow._max.spaceNumber ?? 0;
    if (target >= currentMax) {
      return dataWithError(null, t("dashboard.actions.reduceError"));
    }

    // Keep households, but detach them from spaces that are being removed.
    // (Space # lives on Household — students inherit via household.)
    await prisma.household.updateMany({
      where: { spaceNumber: { gt: target } },
      data: { spaceNumber: null },
    });

    await prisma.space.deleteMany({
      where: { spaceNumber: { gt: target } },
    });

    return dataWithSuccess(null, t("dashboard.actions.reducedGrid", { to: target }));
  }

  if (action === "toggleViewerDrawing") {
    await requireRole(context, "ADMIN");
    const enabled = formData.get("enabled") === "true";
    await prisma.appSettings.upsert({
      where: { orgId: org.id },
      create: { viewerDrawingEnabled: enabled },
      update: { viewerDrawingEnabled: enabled },
    });
    return dataWithSuccess(
      null,
      enabled
        ? t("dashboard.actions.viewerDrawingEnabled")
        : t("dashboard.actions.viewerDrawingDisabled"),
    );
  }

  if (action === "clear") {
    // D1's adapter ignores Prisma $transaction (see prisma:warn in logs); drop
    // to the raw D1 binding so the writes run in a single atomic batch.
    // Bypassing the tenant extension means we inject orgId by hand.
    //
    // We also stamp AppSettings.lastBoardResetAt so the dashboard can show
    // "Reset 7:32am today" vs "Not yet reset today" without scanning Space
    // timestamps. Stored as ISO string; D1's DATETIME column accepts it.
    const d1 = (context as any).cloudflare.env.D1_DATABASE as D1Database;
    const nowIso = new Date().toISOString();
    await d1.batch([
      d1
        .prepare(
          'UPDATE "Space" SET status = ?, timestamp = NULL WHERE orgId = ?',
        )
        .bind(Status.EMPTY, org.id),
      d1.prepare('DELETE FROM "CallEvent" WHERE orgId = ?').bind(org.id),
      // Upsert the stamp. AppSettings has orgId as PK so an INSERT-with-
      // conflict pattern is the cleanest single-statement approach in D1.
      d1
        .prepare(
          'INSERT INTO "AppSettings" ("orgId", "viewerDrawingEnabled", "lastBoardResetAt") VALUES (?, 0, ?) ON CONFLICT("orgId") DO UPDATE SET "lastBoardResetAt" = excluded."lastBoardResetAt"',
        )
        .bind(org.id, nowIso),
    ]);
    try {
      await broadcastBoardReset((context as any).cloudflare.env, org.id);
    } catch {
      // Broadcast failure should not break the action
    }
    return dataWithInfo(null, t("dashboard.actions.resetGrid"));
  }

  if (action === "deleteStudents") {
    await prisma.student.deleteMany();
    return dataWithWarning(null, t("dashboard.actions.deletedAll"));
  }

  return dataWithError(null, t("dashboard.actions.unknown"));
}

// --- View helpers ---------------------------------------------------------
function usageBarColor(ratio: number): string {
  if (ratio >= 1) return "bg-red-500/70";
  if (ratio >= 0.8) return "bg-amber-400/70";
  return "bg-white/10";
}

function PlanUsagePanel({
  usage,
  billingPlan,
}: {
  usage: UsageSnapshot;
  billingPlan: string;
}) {
  const { t } = useTranslation("admin");
  const isAtOrNearLimit =
    usage.worstLevel === "over_cap" ||
    usage.worstLevel === "grace" ||
    usage.worstLevel === "grace_expired";

  const dims: { key: "students" | "families" | "classrooms"; labelKey: string }[] = [
    { key: "students", labelKey: "dashboard.planUsage.students" },
    { key: "families", labelKey: "dashboard.planUsage.families" },
    { key: "classrooms", labelKey: "dashboard.planUsage.classrooms" },
  ];

  return (
    <section className="rounded-xl bg-white/5 border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-base">
            {t("dashboard.planUsage.heading")}
          </h3>
          <p className="text-white/50 text-xs mt-0.5">
            {t("dashboard.planUsage.planLine")}
            <span className="text-white">{billingPlan}</span>
            {" · "}
            <Link to="/admin/billing" className="text-blue-400 hover:underline">
              {t("dashboard.planUsage.manageBilling")}
            </Link>
          </p>
        </div>
        {isAtOrNearLimit && (
          <p className="text-sm text-amber-300 text-right max-w-xs">
            {t("dashboard.planUsage.atOrNearLimit")}{" "}
            <Link to="/admin/billing" className="underline hover:text-amber-200">
              {t("dashboard.planUsage.viewBilling")}
            </Link>
          </p>
        )}
      </div>
      {usage.limits ? (
        <div className="flex flex-col gap-4">
          {dims.map(({ key, labelKey }) => {
            const count = usage.counts[key];
            const cap = usage.limits![key];
            const ratio = cap > 0 ? count / cap : 0;
            const pct = Math.min(100, Math.round(ratio * 100));
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                  <span>{t(labelKey)}</span>
                  <span>
                    {count} / {cap}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${usageBarColor(ratio)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-white/50 text-sm">
          {t("dashboard.planUsage.enterpriseNote")}
        </p>
      )}
    </section>
  );
}

function formatTimeShort(iso: string, locale?: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale ?? undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatRelative(iso: string, t: (k: string, opts?: any) => string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return t("dashboard.activity.justNow");
  if (min < 60) return t("dashboard.activity.minutesAgo", { count: min });
  if (hr < 24) return t("dashboard.activity.hoursAgo", { count: hr });
  if (day < 7) return t("dashboard.activity.daysAgo", { count: day });
  // Older than a week: show the date
  return new Date(iso).toLocaleDateString();
}

function ActivityRow({
  item,
}: {
  item: {
    id: string;
    kind: "drill" | "audit" | "boardReset";
    occurredAt: string;
    actorLabel: string | null;
    onBehalfOfLabel: string | null;
    primary: string;
    secondary?: string;
    href?: string;
  };
}) {
  const { t } = useTranslation("admin");
  const actor = formatActorLabel(
    item.actorLabel,
    item.onBehalfOfLabel,
    t("dashboard.activity.systemActor"),
  );
  const Wrapper = item.href ? Link : "div";
  const wrapperProps: any = item.href
    ? { to: item.href, className: "block" }
    : {};
  return (
    <Wrapper {...wrapperProps}>
      <div className="group flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.04]">
        <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-white/30 group-hover:bg-blue-400/80" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/85">
            {item.primary}
            {item.secondary ? (
              <span className="text-white/40"> · {item.secondary}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-white/45">
            <span className="text-white/60">{actor}</span>
            <span className="px-1 text-white/25">·</span>
            <time dateTime={item.occurredAt}>{formatRelative(item.occurredAt, t)}</time>
          </p>
        </div>
      </div>
    </Wrapper>
  );
}

// --- Page ---------------------------------------------------------------
export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const {
    studentCount,
    spaceCount,
    activeSpaceCount,
    pickupsToday,
    householdCount,
    activeExceptionsToday,
    lastBoardResetAt,
    boardResetToday,
    recentActivity,
    viewerDrawingEnabled,
    isAdmin,
    maxSpaceNumber,
    teachers,
    usage,
    billingPlan,
  } = loaderData;
  const { t } = useTranslation("admin");
  const fetcher = useFetcher();
  const deleteFetcher = useFetcher({ key: "deleteStudents" });
  const settingsFetcher = useFetcher({ key: "viewerDrawing" });
  const resetFetcher = useFetcher({ key: "resetBoard" });
  const [file, setFile] = useState<File | null>(null);
  const [gridSize, setGridSize] = useState("300");
  const [extendTo, setExtendTo] = useState("");
  const [reduceTo, setReduceTo] = useState("");
  const hasExistingGrid = spaceCount > 0;

  const boardResetCaption = useMemo(() => {
    if (!lastBoardResetAt) return t("dashboard.boardReset.never");
    if (boardResetToday) {
      return t("dashboard.boardReset.todayAt", {
        time: formatTimeShort(lastBoardResetAt),
      });
    }
    return t("dashboard.boardReset.staleSince", {
      date: new Date(lastBoardResetAt).toLocaleDateString(),
    });
  }, [lastBoardResetAt, boardResetToday, t]);

  return (
    <div className="flex flex-col gap-8 p-6 max-w-5xl">
      {/* Page header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">
            {t("dashboard.heading")}
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasExistingGrid ? (
            <resetFetcher.Form method="post">
              <input type="hidden" name="action" value="clear" />
              <Button
                type="submit"
                variant={boardResetToday ? "secondary" : "primary"}
                isPending={resetFetcher.state !== "idle"}
              >
                <Eraser className="h-4 w-4" />
                {boardResetToday
                  ? t("dashboard.header.resetAgain")
                  : t("dashboard.header.resetForToday")}
              </Button>
            </resetFetcher.Form>
          ) : null}
        </div>
      </header>

      {/* Today overview — stats row */}
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("dashboard.overview.heading")} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t("dashboard.stats.boardState")}
            value={
              boardResetToday
                ? t("dashboard.stats.boardStateReady")
                : t("dashboard.stats.boardStateStale")
            }
            caption={boardResetCaption}
            icon={
              boardResetToday ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-300" />
              )
            }
            tone={
              boardResetToday
                ? "success"
                : lastBoardResetAt
                  ? "warning"
                  : "default"
            }
          />
          <StatCard
            label={t("dashboard.stats.pickupsToday")}
            value={pickupsToday}
            caption={t("dashboard.stats.pickupsTodayCaption", {
              count: activeSpaceCount,
            })}
            icon={<Hand className="h-4 w-4 text-cyan-300" />}
            tone={pickupsToday > 0 ? "info" : "default"}
          />
          <StatCard
            label={t("dashboard.stats.exceptionsToday")}
            value={activeExceptionsToday}
            caption={t("dashboard.stats.exceptionsTodayCaption")}
            icon={<CalendarClock className="h-4 w-4 text-purple-300" />}
            tone={activeExceptionsToday > 0 ? "info" : "default"}
            href="/admin/households?filter=exceptionToday"
          />
          <StatCard
            label={t("dashboard.stats.roster")}
            value={studentCount}
            caption={t("dashboard.stats.rosterCaption", {
              households: householdCount,
            })}
            icon={<UsersIcon className="h-4 w-4 text-blue-300" />}
            href="/admin/children"
          />
        </div>
      </section>

      {/* Plan usage + recent activity, side by side on wide screens */}
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PlanUsagePanel usage={usage} billingPlan={billingPlan} />
        </div>
        <div className="lg:col-span-2">
          <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <SectionHeader
              title={t("dashboard.activity.heading")}
              count={recentActivity.length || undefined}
            />
            <div className="mt-3 flex-1">
              {recentActivity.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/45">
                  {t("dashboard.activity.empty")}
                </p>
              ) : (
                <div className="-mx-1 flex flex-col gap-0.5">
                  {recentActivity.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-3 border-t border-white/[0.06] pt-3 text-xs">
              <Link
                to="/admin/history"
                className="text-blue-400 hover:underline"
              >
                {t("dashboard.activity.viewAll")}
              </Link>
              <span className="px-2 text-white/25">·</span>
              <Link
                to="/admin/drills/history"
                className="text-blue-400 hover:underline"
              >
                {t("dashboard.activity.viewDrills")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Setup & maintenance — bulk ops demoted below the overview */}
      <section className="flex flex-col gap-5">
        <SectionHeader
          title={t("dashboard.setup.heading")}
          subtitle={t("dashboard.setup.subtitle")}
          icon={<Wrench className="h-4 w-4 text-white/60" />}
        />

        {/* Board management */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              {t("dashboard.grid.heading")}
            </h3>
            <StatusPill tone="neutral">
              {t("dashboard.grid.maxLabel", {
                max: maxSpaceNumber,
                count: spaceCount,
              })}
            </StatusPill>
          </div>

          <Form method="post" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-white/60">
                {t("dashboard.grid.newGridLabel")}
                <input
                  name="gridSize"
                  type="number"
                  min={1}
                  max={5000}
                  value={gridSize}
                  onChange={(e) => setGridSize(e.target.value)}
                  className="app-field w-32 disabled:opacity-50"
                  disabled={hasExistingGrid}
                />
              </label>
              <Button
                variant="primary"
                type="submit"
                value="create"
                name="action"
                isDisabled={hasExistingGrid}
              >
                {t("dashboard.grid.createGrid")}
              </Button>
            </div>
            <p className="text-xs text-amber-200/70">
              {hasExistingGrid
                ? t("dashboard.grid.disabledHint")
                : t("dashboard.grid.newHint")}
            </p>
          </Form>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="action" value="extendGrid" />
              <label className="flex flex-col gap-1 text-sm text-white/60">
                {t("dashboard.grid.extendLabel")}
                <input
                  name="extendTo"
                  type="number"
                  min={1}
                  max={5000}
                  placeholder={t("dashboard.grid.extendPlaceholder", {
                    number: Math.max(maxSpaceNumber + 50, 350),
                  })}
                  value={extendTo}
                  onChange={(e) => setExtendTo(e.target.value)}
                  className="app-field w-36"
                />
              </label>
              <Button variant="secondary" type="submit">
                {t("dashboard.grid.addSpaces")}
              </Button>
            </Form>
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="action" value="reduceGrid" />
              <label className="flex flex-col gap-1 text-sm text-white/60">
                {t("dashboard.grid.reduceLabel")}
                <input
                  name="reduceTo"
                  type="number"
                  min={1}
                  max={5000}
                  placeholder={t("dashboard.grid.reducePlaceholder", {
                    number: Math.max(maxSpaceNumber - 5, 1),
                  })}
                  value={reduceTo}
                  onChange={(e) => setReduceTo(e.target.value)}
                  className="app-field w-36"
                />
              </label>
              <Button variant="danger" type="submit">
                {t("dashboard.grid.reduceGrid")}
              </Button>
            </Form>
          </div>
          <p className="mt-2 text-xs text-amber-200/70">
            {t("dashboard.grid.reduceHint")}
          </p>
        </div>

        {/* Viewer drawing toggle */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-2 flex items-center gap-2">
            <Pencil className="h-4 w-4 text-white/60" />
            <h3 className="text-sm font-semibold text-white">
              {t("dashboard.viewerDrawing.heading")}
            </h3>
            <StatusPill tone={viewerDrawingEnabled ? "success" : "neutral"} dot>
              {viewerDrawingEnabled
                ? t("dashboard.viewerDrawing.enabled")
                : t("dashboard.viewerDrawing.disabled")}
            </StatusPill>
          </div>
          <p className="text-sm text-white/55">
            {t("dashboard.viewerDrawing.body")}
          </p>
          <p className="mt-1 text-xs text-white/40">
            {t("dashboard.viewerDrawing.subtle")}
          </p>
          <div className="mt-3">
            {isAdmin ? (
              <settingsFetcher.Form method="post">
                <input type="hidden" name="action" value="toggleViewerDrawing" />
                <input
                  type="hidden"
                  name="enabled"
                  value={viewerDrawingEnabled ? "false" : "true"}
                />
                <Button
                  type="submit"
                  variant={viewerDrawingEnabled ? "danger" : "primary"}
                  isPending={settingsFetcher.state !== "idle"}
                >
                  {viewerDrawingEnabled
                    ? t("dashboard.viewerDrawing.disable")
                    : t("dashboard.viewerDrawing.enable")}
                </Button>
              </settingsFetcher.Form>
            ) : (
              <p className="text-sm text-amber-200/70">
                {t("dashboard.viewerDrawing.nonAdmin")}
              </p>
            )}
          </div>
        </div>

        {/* Quick CSV import + roster import link */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-2 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-white/60" />
            <h3 className="text-sm font-semibold text-white">
              {t("dashboard.import.heading")}
            </h3>
          </div>
          <p className="text-sm text-white/55">
            {t("dashboard.import.subtitle")}
          </p>
          <fetcher.Form
            encType="multipart/form-data"
            action="/data/students"
            method="post"
            className="mt-3 flex flex-col gap-2"
          >
            <MinimalCsvFileChooser file={file} setFile={setFile} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                isDisabled={file === null || fetcher.state !== "idle"}
                className="self-start"
              >
                {t("dashboard.import.createRecords")}
              </Button>
              <Link
                to="/admin/roster-import"
                className="text-sm text-blue-400 hover:underline"
              >
                {t("dashboard.import.openFullImport")}
              </Link>
            </div>
          </fetcher.Form>
        </div>

        {/* Printables — link to the new dedicated print index */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-2 flex items-center gap-2">
            <Printer className="h-4 w-4 text-white/60" />
            <h3 className="text-sm font-semibold text-white">
              {t("dashboard.printables.heading")}
            </h3>
          </div>
          <p className="text-sm text-white/55">
            {t("dashboard.printables.subtitle", {
              homerooms: teachers.length,
            })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              to="/admin/print"
              className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.08]"
            >
              <Printer className="h-4 w-4" />
              {t("dashboard.printables.open")}
            </Link>
          </div>
        </div>

        {/* Danger zone */}
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/[0.05] p-5">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-300" />
            <h3 className="text-sm font-semibold text-rose-100">
              {t("dashboard.danger.heading")}
            </h3>
          </div>
          <p className="mb-3 text-sm text-rose-200/70">
            {t("dashboard.danger.subtitle")}
          </p>
          <Button
            variant="danger"
            onPress={() =>
              deleteFetcher.submit(
                { action: "deleteStudents" },
                { method: "post" },
              )
            }
            isDisabled={studentCount === 0 || deleteFetcher.state !== "idle"}
          >
            {t("dashboard.danger.deleteAll")}
          </Button>
        </div>
      </section>
    </div>
  );
}
