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
import type { Route } from "./+types/history";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { planAllowsReports } from "~/lib/plan-limits";

export const meta: Route.MetaFunction = () => [
  { title: "Admin – History & Reports" },
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
};

type ParsedFilters = {
  fromDate: Date;
  toDate: Date;
  fromIso: string; // YYYY-MM-DD for form prefill
  toIso: string; // YYYY-MM-DD for form prefill
  room: string | null;
  q: string | null;
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
  ].join(",");
  const body = rows
    .map((r) =>
      [
        csvEscape(new Date(r.createdAt).toISOString()),
        csvEscape(r.studentName),
        csvEscape(r.homeRoomSnapshot ?? ""),
        csvEscape(r.spaceNumber),
        csvEscape(r.studentId ?? ""),
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

  // Plan gate: upsell card for anything under CAMPUS.
  if (!reportsAllowed) {
    if (isCsv) {
      // Be explicit for crafted CSV links rather than silently serving
      // an empty file.
      return new Response("CSV export requires the Campus plan.", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return {
      upgradeRequired: true as const,
      orgName: org.name,
      billingPlan: org.billingPlan,
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
    filters: {
      from: filters.fromIso,
      to: filters.toIso,
      room: filters.room ?? "",
      q: filters.q ?? "",
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
    })),
    truncated,
    rowCap: ROW_CAP,
    summary,
    homerooms,
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Example output: "Apr 21, 2026 3:42 PM"
  const datePart = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} ${timePart}`;
}

export default function AdminHistory({ loaderData }: Route.ComponentProps) {
  if (loaderData.upgradeRequired) {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">History & Reports</h1>
          <p className="text-sm text-white/60">
            Tenant: <span className="text-white">{loaderData.orgName}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm font-semibold text-white">
            Full call history & CSV reports
          </p>
          <p className="text-xs text-white/60">
            See every car-line call with filters by date, homeroom, and
            student, plus summary stats and CSV export for record-keeping.
            Available on the Campus and District plans.
          </p>
          <Link
            to="/admin/billing"
            className="self-start rounded bg-[#E9D500] px-3 py-1.5 text-xs font-semibold text-[#193B4B] hover:brightness-105"
          >
            Upgrade to Campus
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
  const csvHref = `?${csvParams.toString()}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">History & Reports</h1>
        <p className="text-sm text-white/60">
          Tenant: <span className="text-white">{orgName}</span>
        </p>
      </div>

      {/* Filter bar */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          From
          <Input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          To
          <Input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Homeroom
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
            <option value="">All homerooms</option>
            {homerooms.map((room) => (
              <option key={room} value={room}>
                {room}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Student name
          <Input
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="Search name..."
            className="w-52"
          />
        </label>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        <a
          href={csvHref}
          className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
        >
          Export CSV
        </a>
      </Form>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total calls" value={String(summary.totalCalls)} />
        <StatCard
          label="Unique students"
          value={String(summary.uniqueStudents)}
        />
        <StatCard
          label="Busiest day"
          value={
            summary.busiestDay
              ? `${summary.busiestDay.date} (${summary.busiestDay.count})`
              : "—"
          }
        />
        <StatCard
          label="Top homeroom"
          value={
            summary.topHomeroom
              ? `${summary.topHomeroom.name} (${summary.topHomeroom.count})`
              : "—"
          }
        />
      </div>

      {/* Events table */}
      <section>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">No calls in this range.</p>
        ) : (
          <>
            <Table aria-label="Call history">
              <TableContent>
                <TableHeader>
                  <TableColumn isRowHeader>Time</TableColumn>
                  <TableColumn>Student</TableColumn>
                  <TableColumn>Homeroom</TableColumn>
                  <TableColumn>Space</TableColumn>
                </TableHeader>
                <TableBody items={rows as any[]}>
                  {(row: any) => (
                    <TableRow id={String(row.id)} key={row.id}>
                      <TableCell>{formatTime(row.createdAt)}</TableCell>
                      <TableCell>{row.studentName}</TableCell>
                      <TableCell>
                        {row.homeRoomSnapshot ?? (
                          <span className="text-white/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>{row.spaceNumber}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </TableContent>
            </Table>
            {truncated && (
              <p className="mt-3 text-xs text-amber-200/80">
                Showing the most recent {rowCap} calls. Narrow the filters or
                use Export CSV to get the full set.
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
