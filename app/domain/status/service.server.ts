import { getPrisma } from "~/db.server";
import { COMPONENTS } from "./components";

// Typed as any for the same reason as runner.server.ts — `prisma generate`
// wires up statusCheck / statusIncident delegates, but we want this file to
// compile before that runs in CI.
type StatusDb = any;
import type {
  ActiveIncident,
  ComponentId,
  ComponentStatus,
  IncidentSeverity,
  StatusPageComponent,
  UptimeDay
} from "./types";

/**
 * Read-side service for the public /status page. Aggregates the latest check
 * per component, the 90-day uptime grid, and active incidents.
 */
export async function getStatusPageData(context: any): Promise<{
  components: StatusPageComponent[];
  activeIncidents: ActiveIncident[];
  /** Overall rollup pill for the header. */
  overall: ComponentStatus;
  /** Server-side render timestamp (ISO string). */
  renderedAt: string;
}> {
  const db = getPrisma(context) as StatusDb;
  const now = new Date();
  const windowStart = startOfUtcDay(addDaysUtc(now, -89));

  // Pull last 90 days of checks in a single query; bucket in memory. The
  // public page should degrade to "unknown" instead of 500ing if the status
  // read-side tables are unavailable during a deploy or fresh local setup.
  const recentChecks = await safeStatusRead<
    Array<{ componentId: string; status: string; checkedAt: Date }>
  >(
    () =>
      db.statusCheck.findMany({
        where: { checkedAt: { gte: windowStart } },
        orderBy: { checkedAt: "asc" },
        select: {
          componentId: true,
          status: true,
          checkedAt: true
        }
      }),
    []
  );

  // Group by componentId for uptime buckets + latest.
  const byComponent = new Map<
    string,
    Array<{ status: string; checkedAt: Date }>
  >();
  for (const c of recentChecks) {
    const list = byComponent.get(c.componentId) ?? [];
    list.push({ status: c.status, checkedAt: c.checkedAt });
    byComponent.set(c.componentId, list);
  }

  const openIncidents = await safeStatusRead<
    Array<{
      id: string;
      componentId: string;
      severity: string;
      title: string;
      startedAt: Date;
    }>
  >(
    () =>
      db.statusIncident.findMany({
        where: { resolvedAt: null },
        orderBy: { startedAt: "desc" }
      }),
    []
  );

  const components: StatusPageComponent[] = COMPONENTS.map((def) => {
    const rows = byComponent.get(def.id) ?? [];
    const latest = rows[rows.length - 1];
    const currentStatus: ComponentStatus = latest
      ? normalizeStatus(latest.status)
      : "unknown";
    const note = staticNoteFor(def.id, currentStatus);
    return {
      id: def.id,
      section: def.section,
      name: def.name,
      description: def.description,
      currentStatus,
      note,
      uptime90d: buildUptimeGrid(rows, now)
    };
  });

  const componentNameById = new Map<string, string>(
    COMPONENTS.map((c) => [c.id, c.name])
  );
  const activeIncidents: ActiveIncident[] = (
    openIncidents as Array<{
      id: string;
      componentId: string;
      severity: string;
      title: string;
      startedAt: Date;
    }>
  ).map((i) => ({
    id: i.id,
    componentId: i.componentId as ComponentId,
    componentName: componentNameById.get(i.componentId) ?? i.componentId,
    severity: normalizeSeverity(i.severity),
    title: i.title,
    startedAt: i.startedAt.toISOString()
  }));

  const overall = rollupOverall(components);

  return {
    components,
    activeIncidents,
    overall,
    renderedAt: now.toISOString()
  };
}

// ---- helpers --------------------------------------------------------------

async function safeStatusRead<T>(
  read: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown";
    console.warn(`status page read failed; rendering unknown status (${code})`);
    return fallback;
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function utcDateKey(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

function normalizeStatus(raw: string): ComponentStatus {
  if (
    raw === "operational" ||
    raw === "degraded" ||
    raw === "outage" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return "unknown";
}

function normalizeSeverity(raw: string): IncidentSeverity {
  return raw === "outage" ? "outage" : "degraded";
}

/**
 * Given a chronologically sorted list of checks, build a 90-length array
 * indexed by UTC day. Each day rolls up to the worst status seen that day.
 */
function buildUptimeGrid(
  rows: Array<{ status: string; checkedAt: Date }>,
  now: Date
): UptimeDay[] {
  const today = startOfUtcDay(now);
  const buckets = new Map<string, ComponentStatus>();

  for (const row of rows) {
    const key = utcDateKey(row.checkedAt);
    const prev = buckets.get(key) ?? "unknown";
    buckets.set(key, worstOf(prev, normalizeStatus(row.status)));
  }

  const out: UptimeDay[] = [];
  for (let i = 89; i >= 0; i--) {
    const day = addDaysUtc(today, -i);
    const key = utcDateKey(day);
    out.push({
      date: key,
      status: buckets.get(key) ?? "unknown"
    });
  }
  return out;
}

/** Order: outage > degraded > operational > unknown. Unknown never wins. */
function worstOf(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  const rank: Record<ComponentStatus, number> = {
    unknown: 0,
    operational: 1,
    degraded: 2,
    outage: 3
  };
  return rank[a] >= rank[b] ? a : b;
}

function rollupOverall(components: StatusPageComponent[]): ComponentStatus {
  let worst: ComponentStatus = "operational";
  let seenKnown = false;
  for (const c of components) {
    if (c.currentStatus === "unknown") continue;
    seenKnown = true;
    worst = worstOf(worst, c.currentStatus);
  }
  return seenKnown ? worst : "unknown";
}

function staticNoteFor(
  id: ComponentId,
  current: ComponentStatus
): string | null {
  if (id === "resend" && current === "unknown") {
    return "Resend doesn't publish a status feed — we surface issues indirectly via the Queue probe.";
  }
  return null;
}
