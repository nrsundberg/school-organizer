import { getPrisma } from "~/db.server";
import { COMPONENTS } from "./components";
import { runProbe } from "./probes.server";
import type { ComponentStatus, ProbeResult } from "./types";

// `prisma generate` populates StatusCheck / StatusIncident delegates on the
// generated client. Typed as `any` here so this file compiles in CI before
// generate has run — matches the pattern in other domain/*.server.ts files
// that pass `db` as `any` around helpers.
type StatusDb = any;

/**
 * Runs every component probe in parallel, persists results, and advances the
 * incident state machine. Safe to call from the 2-minute cron; caller should
 * wrap in try/catch so one failure can't poison other schedulers.
 *
 * Incident state machine (per-component):
 *   - 3 consecutive non-operational results → open an incident. Severity is
 *     'outage' if any of those three was 'outage', else 'degraded'.
 *   - Already-open incident + new fail → update lastFailAt; escalate
 *     degraded→outage if the new fail is 'outage'.
 *   - Already-open incident + 2 consecutive operational results → set
 *     resolvedAt and close.
 *
 * "Unknown" is treated as neutral — it neither opens nor closes incidents.
 */
export async function runStatusProbes(context: any): Promise<{
  checks: number;
  incidentsOpened: number;
  incidentsResolved: number;
}> {
  const env = context?.cloudflare?.env as Env | undefined;
  if (!env) {
    throw new Error("runStatusProbes: cloudflare env not found on context");
  }
  const db = getPrisma(context) as StatusDb;
  const now = new Date();

  // Skip components fed by the external uptime monitor (POSTs to
  // /api/status-probe). Writing `unknown` here on every tick would clobber the
  // webhook's `operational` rows in `recent[0]` and prevent the state machine
  // from ever seeing two consecutive operationals — incidents would stay open.
  const cronComponents = COMPONENTS.filter((c) => c.probe !== "external");

  const settled = await Promise.allSettled(
    cronComponents.map((c) => runProbe(c, env)),
  );

  const results: ProbeResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      componentId: cronComponents[i]!.id,
      status: "outage",
      latencyMs: null,
      detail: `probe rejected: ${String(s.reason).slice(0, 400)}`,
    };
  });

  // Persist every check row.
  if (results.length) {
    await db.statusCheck.createMany({
      data: results.map((r) => ({
        componentId: r.componentId,
        status: r.status,
        latencyMs: r.latencyMs,
        detail: r.detail,
        checkedAt: now,
      })),
    });
  }

  // State-machine pass per component.
  let opened = 0;
  let resolved = 0;
  for (const result of results) {
    const changed = await advanceIncidentForComponent(db, result, now);
    if (changed === "opened") opened++;
    else if (changed === "resolved") resolved++;
  }

  return { checks: results.length, incidentsOpened: opened, incidentsResolved: resolved };
}

/**
 * Single-component variant of `runStatusProbes`, for the /api/status-probe
 * webhook fed by the external uptime monitor. Persists the row and advances
 * the incident state machine using the exact same logic the cron uses.
 */
export async function recordProbeResult(
  context: any,
  result: ProbeResult,
): Promise<IncidentChange> {
  const env = context?.cloudflare?.env as Env | undefined;
  if (!env) {
    throw new Error("recordProbeResult: cloudflare env not found on context");
  }
  const db = getPrisma(context) as StatusDb;
  const now = new Date();
  await db.statusCheck.create({
    data: {
      componentId: result.componentId,
      status: result.status,
      latencyMs: result.latencyMs,
      detail: result.detail,
      checkedAt: now,
    },
  });
  return advanceIncidentForComponent(db, result, now);
}

type IncidentChange = "opened" | "resolved" | null;

async function advanceIncidentForComponent(
  db: StatusDb,
  result: ProbeResult,
  now: Date,
): Promise<IncidentChange> {
  const openIncident = await db.statusIncident.findFirst({
    where: { componentId: result.componentId, resolvedAt: null },
    orderBy: { startedAt: "desc" },
  });

  // Recent history: most-recent-first so index 0 is the just-inserted row.
  const recent = await db.statusCheck.findMany({
    where: { componentId: result.componentId },
    orderBy: { checkedAt: "desc" },
    take: 5,
  });

  if (openIncident) {
    const last = recent[0];
    const prev = recent[1];
    if (last && prev && last.status === "operational" && prev.status === "operational") {
      await db.statusIncident.update({
        where: { id: openIncident.id },
        data: { resolvedAt: now },
      });
      return "resolved";
    }
    if (isFail(result.status)) {
      // Escalate severity if we just saw an outage.
      const shouldEscalate =
        openIncident.severity === "degraded" && result.status === "outage";
      await db.statusIncident.update({
        where: { id: openIncident.id },
        data: {
          lastFailAt: now,
          ...(shouldEscalate
            ? { severity: "outage", title: escalatedTitle(result.componentId) }
            : {}),
        },
      });
    }
    return null;
  }

  // No open incident: check for 3 consecutive fails (including this latest).
  if (!isFail(result.status)) return null;
  const lastThree: Array<{ status: string }> = recent.slice(0, 3);
  if (lastThree.length < 3) return null;
  if (!lastThree.every((c) => isFail(c.status as ComponentStatus))) return null;

  const severity = lastThree.some((c) => c.status === "outage")
    ? "outage"
    : "degraded";
  await db.statusIncident.create({
    data: {
      componentId: result.componentId,
      severity,
      title: defaultTitle(result.componentId, severity),
      startedAt: now,
      lastFailAt: now,
      source: "auto",
    },
  });
  return "opened";
}

function isFail(s: ComponentStatus): boolean {
  return s === "degraded" || s === "outage";
}

function defaultTitle(
  componentId: string,
  severity: "degraded" | "outage",
): string {
  const label = severity === "outage" ? "Outage" : "Degraded performance";
  return `${label}: ${componentId}`;
}

function escalatedTitle(componentId: string): string {
  return `Outage: ${componentId}`;
}
