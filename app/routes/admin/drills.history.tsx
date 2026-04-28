import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRow,
} from "@heroui/react";
import { BadgeCheck, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.history";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { formatActorLabel } from "~/domain/auth/format-actor";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import {
  isDrillRunStatus,
  parseDrillAudience,
  parseDrillMode,
  type DrillAudience,
  type DrillMode,
  type DrillRunStatus,
} from "~/domain/drills/types";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Drill history" },
];

/**
 * Cap to keep the table payload bounded. The `truncated` flag in the loader
 * signals when we hit the cap so the UI can show a "showing most recent N"
 * notice (mirrors the pattern in `admin/history.tsx`).
 */
const ROW_CAP = 200;

type HistoryRow = {
  id: string;
  templateId: string;
  templateName: string;
  status: DrillRunStatus;
  /** "DRILL" | "ACTUAL" | "FALSE_ALARM" — captured at start time. */
  mode: DrillMode;
  audience: DrillAudience;
  createdAtIso: string;
  activatedAtIso: string | null;
  endedAtIso: string | null;
  /** Server-computed; null when both endpoints are missing. */
  durationSeconds: number | null;
  lastActorUserId: string | null;
  lastActorUserName: string | null;
  lastActorOnBehalfOfUserId: string | null;
  lastActorOnBehalfOfUserName: string | null;
  /** True when a responsible party has signed off the drill record. */
  isSignedOff: boolean;
};

function computeDurationSeconds(
  activatedAt: Date | null,
  createdAt: Date,
  endedAt: Date | null,
): number | null {
  // Prefer activatedAt → endedAt; fall back to createdAt → endedAt for
  // historical rows that never had a separate "activated" step.
  const start = activatedAt ?? createdAt;
  if (!endedAt) return null;
  const ms = endedAt.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  // Fetch ROW_CAP + 1 to detect truncation without a second count query.
  const [fetched, locale] = await Promise.all([
    prisma.drillRun.findMany({
      orderBy: { createdAt: "desc" },
      take: ROW_CAP + 1,
      include: { template: { select: { id: true, name: true } } },
    }),
    detectLocale(request, context),
  ]);

  const truncated = fetched.length > ROW_CAP;
  const slice = truncated ? fetched.slice(0, ROW_CAP) : fetched;

  // Resolve display names for both halves of the actor pair (the human who
  // clicked + the impersonated user, when present) in one batched query.
  const userIdsForLookup = new Set<string>();
  for (const r of slice as any[]) {
    if (r.lastActorUserId) userIdsForLookup.add(r.lastActorUserId);
    if (r.lastActorOnBehalfOfUserId) {
      userIdsForLookup.add(r.lastActorOnBehalfOfUserId);
    }
  }
  const userNameById = new Map<string, string>();
  if (userIdsForLookup.size) {
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIdsForLookup) } },
      select: { id: true, name: true },
    });
    for (const u of users) {
      if (u.name && u.name.trim() !== "") userNameById.set(u.id, u.name);
    }
  }

  const rows: HistoryRow[] = slice.map((r: any) => {
    const status: DrillRunStatus = isDrillRunStatus(r.status)
      ? r.status
      : "ENDED";
    return {
      id: r.id,
      templateId: r.templateId,
      // Defensive — the FK is required in schema, but if a template was
      // hard-deleted with a stale row, fall back to a placeholder.
      templateName: r.template?.name ?? "(deleted template)",
      status,
      mode: parseDrillMode(r.mode),
      audience: parseDrillAudience(r.audience),
      createdAtIso: r.createdAt.toISOString(),
      activatedAtIso: r.activatedAt ? r.activatedAt.toISOString() : null,
      endedAtIso: r.endedAt ? r.endedAt.toISOString() : null,
      durationSeconds: computeDurationSeconds(
        r.activatedAt,
        r.createdAt,
        r.endedAt,
      ),
      lastActorUserId: r.lastActorUserId,
      lastActorUserName: r.lastActorUserId
        ? userNameById.get(r.lastActorUserId) ?? null
        : null,
      lastActorOnBehalfOfUserId: r.lastActorOnBehalfOfUserId ?? null,
      lastActorOnBehalfOfUserName: r.lastActorOnBehalfOfUserId
        ? userNameById.get(r.lastActorOnBehalfOfUserId) ?? null
        : null,
      isSignedOff: !!r.signedOffAt,
    };
  });

  const t = await getFixedT(locale, "admin");

  return {
    rows,
    truncated,
    rowCap: ROW_CAP,
    metaTitle: t("drillsHistory.metaTitle"),
  };
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} ${timePart}`;
}

export function formatDurationSeconds(secs: number | null): string {
  if (secs == null) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) {
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
}

/**
 * Mode badge, mirroring the one on the replay detail page. Local copy (rather
 * than a cross-route import) so the history list keeps working even if the
 * detail route changes shape — the badges are visually identical and there
 * are only three modes, so duplication is cheaper than coupling.
 */
function ModeChip({ mode }: { mode: DrillMode }) {
  const { t } = useTranslation("admin");
  const cls =
    mode === "ACTUAL"
      ? "bg-amber-500/25 text-amber-100 border border-amber-400/50"
      : mode === "FALSE_ALARM"
        ? "bg-purple-500/20 text-purple-100 border border-purple-400/40"
        : "bg-white/10 text-white/70 border border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {t(`drills.mode.${mode === "ACTUAL" ? "actualShort" : mode === "FALSE_ALARM" ? "falseAlarmShort" : "drillShort"}`)}
    </span>
  );
}

function StatusChip({ status }: { status: DrillRunStatus }) {
  const { t } = useTranslation("admin");
  // Each status maps to a distinct color + (for LIVE only) a pulse animation.
  // The "pulse" cue is doubled with a leading dot icon so screen-reader users
  // and color-blind users still see "Live" + a shape change, not just hue.
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

export default function AdminDrillsHistory({
  loaderData,
}: Route.ComponentProps) {
  const { rows, truncated, rowCap } = loaderData;
  const { t, i18n } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <History className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t("drillsHistory.heading")}
          </h1>
          <p className="text-white/50 text-sm mt-1">
            {t("drillsHistory.subtitle")}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
          <p>{t("drillsHistory.empty.body")}</p>
          <Link
            to="/admin/drills"
            className="mt-3 inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
          >
            {t("drillsHistory.empty.cta")}
          </Link>
        </div>
      ) : (
        <section>
          <Table aria-label={t("drillsHistory.table.ariaLabel")}>
            <TableContent>
              <TableHeader>
                <TableColumn isRowHeader>
                  {t("drillsHistory.table.template")}
                </TableColumn>
                <TableColumn>{t("drillsHistory.table.started")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.ended")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.duration")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.mode")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.status")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.audience")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.actor")}</TableColumn>
                <TableColumn>{t("drillsHistory.table.signoff")}</TableColumn>
              </TableHeader>
              <TableBody items={rows as any[]}>
                {(row: any) => (
                  <TableRow id={row.id} key={row.id}>
                    <TableCell>
                      <Link
                        to={`/admin/drills/history/${row.id}`}
                        className="font-medium text-white hover:text-blue-300 transition-colors"
                      >
                        {row.templateName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatDateTime(
                        row.activatedAtIso ?? row.createdAtIso,
                        i18n.language,
                      )}
                    </TableCell>
                    <TableCell>
                      {row.endedAtIso ? (
                        formatDateTime(row.endedAtIso, i18n.language)
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDurationSeconds(row.durationSeconds)}
                    </TableCell>
                    <TableCell>
                      <ModeChip mode={row.mode} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={row.status} />
                    </TableCell>
                    <TableCell>
                      <AudienceChip audience={row.audience} />
                    </TableCell>
                    <TableCell>
                      {row.lastActorUserId || row.lastActorOnBehalfOfUserId ? (
                        (() => {
                          const actorPart =
                            row.lastActorUserName ??
                            row.lastActorUserId ??
                            null;
                          const onBehalfPart =
                            row.lastActorOnBehalfOfUserName ??
                            row.lastActorOnBehalfOfUserId ??
                            null;
                          const fullLabel = formatActorLabel(
                            actorPart,
                            onBehalfPart,
                            "—",
                          );
                          return (
                            <span
                              className="flex flex-wrap items-center gap-2"
                              title={row.lastActorUserId ?? undefined}
                              aria-label={fullLabel}
                            >
                              <span className="text-xs text-white/80">
                                {actorPart ?? fullLabel}
                              </span>
                              {onBehalfPart && actorPart && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                                  <span className="uppercase tracking-wide">
                                    via
                                  </span>
                                  <span>{onBehalfPart}</span>
                                </span>
                              )}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.isSignedOff ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                          <BadgeCheck className="w-3 h-3" />
                          {t("drillsHistory.signoff.indicator")}
                        </span>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </TableContent>
          </Table>
          {truncated && (
            <p className="mt-3 text-xs text-amber-200/80">
              {t("drillsHistory.table.truncated", { cap: rowCap })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
