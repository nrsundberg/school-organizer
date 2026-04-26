import { Form, Link } from "react-router";
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRow,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/history";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { planAllowsReports } from "~/lib/plan-limits";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – History & Reports" },
];

/**
 * We cap the rendered table to avoid shipping an unbounded payload to the
 * browser; admins with more than this should narrow filters or export CSV.
 * The CSV path ignores this cap.
 */
const ROW_CAP = 500;

type CallEventRow = {
  id: number;
  spaceNumber: number;
  studentId: number | null;
  studentName: string;
  homeRoomSnapshot: string | null;
  createdAt: Date;
  actorUserId: string | null;
  onBehalfOfUserId: string | null;
};

type ParsedFilters = {
  fromDate: Date;
  toDate: Date;
  fromIso: string; // YYYY-MM-DD for form prefill
  toIso: string; // YYYY-MM-DD for form prefill
  room: string | null;
  q: string | null;
  impersonatedOnly: boolean;
};

/**
 * Parse search-param filters. Dates default to the last 30 days (inclusive)
 * and invalid/missing values fall back to the defaults — bad input shouldn't
 * 500 the page, just ignore it.
 */
function parseFilters(url: URL): ParsedFilters {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);

  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const rawRoom = url.searchParams.get("room");
  const rawQ = url.searchParams.get("q");
  const rawImpersonated = url.searchParams.get("impersonated");

  const fromDate = parseDateInput(rawFrom, defaultFrom, false);
  // For `to`, interpret as end-of-day so a single calendar day includes events
  // recorded later that day.
  const toDate = parseDateInput(rawTo, now, true);

  return {
    fromDate,
    toDate,
    fromIso: toYmd(fromDate),
    toIso: toYmd(toDate),
    room: rawRoom && rawRoom.trim() !== "" ? rawRoom.trim() : null,
    q: rawQ && rawQ.trim() !== "" ? rawQ.trim() : null,
    impersonatedOnly: rawImpersonated === "1",
  };
}

function parseDateInput(
  raw: string | null,
  fallback: Date,
  endOfDay: boolean,
): Date {
  if (!raw) return fallback;
  // Accept YYYY-MM-DD (from <input type="date">) or a full ISO string.
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const parts = [Number(y), Number(m) - 1, Number(d)] as const;
    const base = endOfDay
      ? new Date(Date.UTC(parts[0], parts[1], parts[2], 23, 59, 59, 999))
      : new Date(Date.UTC(parts[0], parts[1], parts[2], 0, 0, 0, 0));
    return Number.isNaN(base.getTime()) ? fallback : base;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchCallEvents(
  prisma: ReturnType<typeof getTenantPrisma>,
  filters: ParsedFilters,
  opts: { limit?: number },
): Promise<CallEventRow[]> {
  const where: Record<string, unknown> = {
    createdAt: {
      gte: filters.fromDate,
      lte: filters.toDate,
    },
  };
  if (filters.room) {
    where.homeRoomSnapshot = filters.room;
  }
  if (filters.impersonatedOnly) {
    where.onBehalfOfUserId = { not: null };
  }

  const rows = (await prisma.callEvent.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    // Fetch a bit over the cap so we can tell the caller "truncated?".
    // For CSV (no limit), omit `take`.
    take: opts.limit ? opts.limit + 1 : undefined,
  })) as CallEventRow[];

  // SQLite Prisma doesn't support `mode: "insensitive"`, so filter in memory.
  // This runs after the date+room narrowing so we don't scan the whole table.
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    return rows.filter((r) => r.studentName.toLowerCase().includes(needle));
  }
  return rows;
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: CallEventRow[]): string {
  const header = [
    "createdAt",
    "studentName",
    "homeRoom",
    "spaceNumber",
    "studentId",
    "actorUserId",
    "onBehalfOfUserId",
  ].join(",");
  const body = rows
    .map((r) =>
      [
        csvEscape(new Date(r.createdAt).toISOString()),
        csvEscape(r.studentName),
        csvEscape(r.homeRoomSnapshot ?? ""),
        csvEscape(r.spaceNumber),
        csvEscape(r.studentId ?? ""),
        csvEscape(r.actorUserId ?? ""),
        csvEscape(r.onBehalfOfUserId ?? ""),
      ].join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

type SummaryStats = {
  totalCalls: number;
  uniqueStudents: number;
  busiestDay: { date: string; count: number } | null;
  topHomeroom: { name: string; count: number } | null;
};

function computeSummary(rows: CallEventRow[]): SummaryStats {
  const totalCalls = rows.length;

  const studentIds = new Set<number>();
  const unknownStudentNames = new Set<string>();
  for (const r of rows) {
    if (r.studentId != null) studentIds.add(r.studentId);
    else unknownStudentNames.add(r.studentName);
  }
  const uniqueStudents = studentIds.size + unknownStudentNames.size;

  const byDay = new Map<string, number>();
  const byRoom = new Map<string, number>();
  for (const r of rows) {
    const day = toYmd(new Date(r.createdAt));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (r.homeRoomSnapshot) {
      byRoom.set(
        r.homeRoomSnapshot,
        (byRoom.get(r.homeRoomSnapshot) ?? 0) + 1,
      );
    }
  }

  let busiestDay: SummaryStats["busiestDay"] = null;
  for (const [date, count] of byDay) {
    if (!busiestDay || count > busiestDay.count) {
      busiestDay = { date, count };
    }
  }

  let topHomeroom: SummaryStats["topHomeroom"] = null;
  for (const [name, count] of byRoom) {
    if (!topHomeroom || count > topHomeroom.count) {
      topHomeroom = { name, count };
    }
  }

  return { totalCalls, uniqueStudents, busiestDay, topHomeroom };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);

  const url = new URL(request.url);
  const isCsv = url.searchParams.get("format") === "csv";

  const reportsAllowed = planAllowsReports(org.billingPlan);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  // Plan gate: upsell card for anything under CAMPUS.
  if (!reportsAllowed) {
    if (isCsv) {
      // Be explicit for crafted CSV links rather than silently serving
      // an empty file.
      return new Response(t("history.upgrade.csvForbidden"), {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return {
      upgradeRequired: true as const,
      orgName: org.name,
      billingPlan: org.billingPlan,
      metaTitle: t("history.metaTitle"),
    };
  }

  const filters = parseFilters(url);

  if (isCsv) {
    const rows = await fetchCallEvents(prisma, filters, {});
    const csv = buildCsv(rows);
    const filename = `call-history-${filters.fromIso}-${filters.toIso}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Fetch ROW_CAP + 1 so we can detect truncation without a second count query.
  const fetched = await fetchCallEvents(prisma, filters, { limit: ROW_CAP });
  const truncated = fetched.length > ROW_CAP;
  const rows = truncated ? fetched.slice(0, ROW_CAP) : fetched;

  // Summary is computed over the rendered (possibly truncated) result set.
  // If the user hit truncation, the UI notice tells them so; a full summary
  // would require a second scan we're choosing not to pay for here.
  const summary = computeSummary(rows);

  // Distinct homerooms that appear in the visible rows — good enough for
  // filter discovery without a separate aggregate query.
  const homeroomSet = new Set<string>();
  for (const r of rows) {
    if (r.homeRoomSnapshot) homeroomSet.add(r.homeRoomSnapshot);
  }
  // Include the currently-selected room even if it's not in the visible set
  // so the Select still reflects it.
  if (filters.room) homeroomSet.add(filters.room);
  const homerooms = Array.from(homeroomSet).sort();

  return {
    upgradeRequired: false as const,
    orgName: org.name,
    orgSlug: org.slug,
    billingPlan: org.billingPlan,
    metaTitle: t("history.metaTitle"),
    filters: {
      from: filters.fromIso,
      to: filters.toIso,
      room: filters.room ?? "",
      q: filters.q ?? "",
      impersonatedOnly: filters.impersonatedOnly,
    },
    rows: rows.map((r) => ({
      id: r.id,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt).toISOString(),
      studentName: r.studentName,
      homeRoomSnapshot: r.homeRoomSnapshot,
      spaceNumber: r.spaceNumber,
      studentId: r.studentId,
      actorUserId: r.actorUserId,
      onBehalfOfUserId: r.onBehalfOfUserId,
    })),
    truncated,
    rowCap: ROW_CAP,
    summary,
    homerooms,
  };
}

function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Example output: "Apr 21, 2026 3:42 PM"
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

export default function AdminHistory({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("admin");

  if (loaderData.upgradeRequired) {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("history.heading")}</h1>
          <p className="text-sm text-white/60">
            {t("history.tenant")}<span className="text-white">{loaderData.orgName}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm font-semibold text-white">
            {t("history.upgrade.title")}
          </p>
          <p className="text-xs text-white/60">
            {t("history.upgrade.body")}
          </p>
          <Link
            to="/admin/billing"
            className="self-start rounded bg-[#E9D500] px-3 py-1.5 text-xs font-semibold text-[#193B4B] hover:brightness-105"
          >
            {t("history.upgrade.cta")}
          </Link>
        </div>
      </div>
    );
  }

  const { filters, rows, truncated, rowCap, summary, homerooms, orgName } =
    loaderData;

  // Build the CSV export href by carrying the current filters forward.
  const csvParams = new URLSearchParams();
  csvParams.set("format", "csv");
  if (filters.from) csvParams.set("from", filters.from);
  if (filters.to) csvParams.set("to", filters.to);
  if (filters.room) csvParams.set("room", filters.room);
  if (filters.q) csvParams.set("q", filters.q);
  if (filters.impersonatedOnly) csvParams.set("impersonated", "1");
  const csvHref = `?${csvParams.toString()}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t("history.heading")}</h1>
        <p className="text-sm text-white/60">
          {t("history.tenant")}<span className="text-white">{orgName}</span>
        </p>
      </div>

      {/* Filter bar */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {t("history.filters.from")}
          <Input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {t("history.filters.to")}
          <Input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {t("history.filters.homeroom")}
          {/*
            HeroUI's Select is a compound / data-driven component; using a
            plain <select> keeps this a simple GET form and matches the
            native-select pattern already used in users.tsx / dashboard.tsx.
          */}
          <select
            name="room"
            defaultValue={filters.room}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white text-sm w-48"
          >
            <option value="">{t("history.filters.allHomerooms")}</option>
            {homerooms.map((room) => (
              <option key={room} value={room}>
                {room}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {t("history.filters.studentName")}
          <Input
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder={t("history.filters.searchPlaceholder")}
            className="w-52"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60 mt-5">
          <input
            type="checkbox"
            name="impersonated"
            value="1"
            defaultChecked={filters.impersonatedOnly}
            className="rounded border-white/20 bg-white/5"
          />
          {t("history.filters.showImpersonatedOnly")}
        </label>
        <Button type="submit" variant="primary">
          {t("history.filters.apply")}
        </Button>
        <a
          href={csvHref}
          className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
        >
          {t("history.filters.exportCsv")}
        </a>
      </Form>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("history.stats.totalCalls")} value={String(summary.totalCalls)} />
        <StatCard
          label={t("history.stats.uniqueStudents")}
          value={String(summary.uniqueStudents)}
        />
        <StatCard
          label={t("history.stats.busiestDay")}
          value={
            summary.busiestDay
              ? `${summary.busiestDay.date} (${summary.busiestDay.count})`
              : t("history.stats.dash")
          }
        />
        <StatCard
          label={t("history.stats.topHomeroom")}
          value={
            summary.topHomeroom
              ? `${summary.topHomeroom.name} (${summary.topHomeroom.count})`
              : t("history.stats.dash")
          }
        />
      </div>

      {/* Events table */}
      <section>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">{t("history.table.noCalls")}</p>
        ) : (
          <>
            <Table aria-label={t("history.table.ariaLabel")}>
              <TableContent>
                <TableHeader>
                  <TableColumn isRowHeader>{t("history.table.time")}</TableColumn>
                  <TableColumn>{t("history.table.student")}</TableColumn>
                  <TableColumn>{t("history.table.homeroom")}</TableColumn>
                  <TableColumn>{t("history.table.space")}</TableColumn>
                  <TableColumn>{t("history.table.actor")}</TableColumn>
                </TableHeader>
                <TableBody items={rows as any[]}>
                  {(row: any) => (
                    <TableRow id={String(row.id)} key={row.id}>
                      <TableCell>{formatTime(row.createdAt, i18n.language)}</TableCell>
                      <TableCell>{row.studentName}</TableCell>
                      <TableCell>
                        {row.homeRoomSnapshot ?? (
                          <span className="text-white/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>{row.spaceNumber}</TableCell>
                      <TableCell>
                        {row.actorUserId ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-white/80">
                              {row.actorUserId}
                            </span>
                            {row.onBehalfOfUserId && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                {t("history.table.impersonatedBadge")}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-white/40">
                            {t("history.table.anonymousActor")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </TableContent>
            </Table>
            {truncated && (
              <p className="mt-3 text-xs text-amber-200/80">
                {t("history.table.truncated", { cap: rowCap })}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs text-white/50">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
