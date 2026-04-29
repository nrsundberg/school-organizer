import type {
  ComponentDef,
  ComponentStatus,
  ProbeResult,
} from "./types";

/**
 * Per-component probe functions. Every probe must:
 *   - return a `ProbeResult` (never throw — catch and return 'outage' with detail).
 *   - complete quickly (a hung probe blocks the runner's Promise.allSettled).
 *
 * Latency is recorded for internal diagnostics only and is NOT rendered on
 * the public /status page.
 */

const PROBE_TIMEOUT_MS = 8_000;

export async function runProbe(
  component: ComponentDef,
  env: Env,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    switch (component.probe) {
      case "http":
        return await httpProbe(component, started);
      case "d1":
        return await d1Probe(component, env, started);
      case "r2":
        return await r2Probe(component, env, started);
      case "queue":
        return await queueProbe(component, env, started);
      case "resend_manual":
        return resendManualProbe(component);
      case "stripe_status":
        return await stripeStatusProbe(component, env, started);
      case "stripe_status_component":
        return await stripeComponentProbe(component, env, started);
      case "tenants_aggregate":
        return await tenantsAggregateProbe(component, env, started);
      case "external":
        return externalProbe(component);
      default: {
        const exhaustive: never = component.probe;
        return {
          componentId: component.id,
          status: "unknown",
          latencyMs: null,
          detail: `unknown probe kind: ${String(exhaustive)}`,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      componentId: component.id,
      status: "outage",
      latencyMs: Date.now() - started,
      detail: `probe threw: ${message}`.slice(0, 500),
    };
  }
}

// ---- HTTP -----------------------------------------------------------------

async function httpProbe(
  component: ComponentDef,
  started: number,
): Promise<ProbeResult> {
  const url = String(component.config.url ?? "");
  const expectStatus = Number(component.config.expectStatus ?? 200);
  const expectSubstring =
    typeof component.config.expectSubstring === "string"
      ? (component.config.expectSubstring as string)
      : null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "PickupRoster-StatusProbe/1" },
    });
    const latencyMs = Date.now() - started;
    const statusOk =
      res.status === expectStatus ||
      (expectStatus === 200 && res.status >= 200 && res.status < 300);

    if (!statusOk) {
      return {
        componentId: component.id,
        status: "outage",
        latencyMs,
        detail: `unexpected HTTP ${res.status}`,
      };
    }

    if (expectSubstring) {
      const body = await res.text();
      if (!body.includes(expectSubstring)) {
        return {
          componentId: component.id,
          status: "degraded",
          latencyMs,
          detail: `body missing expected string`,
        };
      }
    }
    return {
      componentId: component.id,
      status: "operational",
      latencyMs,
      detail: null,
    };
  } finally {
    clearTimeout(t);
  }
}

// ---- D1 -------------------------------------------------------------------

async function d1Probe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const d1 = env.D1_DATABASE;
  if (!d1) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: null,
      detail: "D1_DATABASE binding missing",
    };
  }
  const res = await d1.prepare("SELECT 1 as ok").first<{ ok: number }>();
  const latencyMs = Date.now() - started;
  if (res && res.ok === 1) {
    return {
      componentId: component.id,
      status: "operational",
      latencyMs,
      detail: null,
    };
  }
  return {
    componentId: component.id,
    status: "outage",
    latencyMs,
    detail: "SELECT 1 returned unexpected row",
  };
}

// ---- R2 -------------------------------------------------------------------

async function r2Probe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const bindingName = String(component.config.bucketBinding ?? "");
  const sentinelKey = String(component.config.sentinelKey ?? "");
  const bucket = (env as unknown as Record<string, R2Bucket | undefined>)[
    bindingName
  ];
  if (!bucket) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: null,
      detail: `R2 binding ${bindingName} missing`,
    };
  }
  const head = await bucket.head(sentinelKey);
  const latencyMs = Date.now() - started;
  if (head) {
    return {
      componentId: component.id,
      status: "operational",
      latencyMs,
      detail: null,
    };
  }
  // Missing sentinel is a config issue, not an outage. We report unknown so
  // the pill is gray until the user seeds the object.
  return {
    componentId: component.id,
    status: "unknown",
    latencyMs,
    detail: `sentinel object "${sentinelKey}" not found — seed it to enable this probe`,
  };
}

// ---- Queues ---------------------------------------------------------------

async function queueProbe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const bindingName = String(component.config.queueBinding ?? "");
  const queue = (env as unknown as Record<string, Queue<unknown> | undefined>)[
    bindingName
  ];
  if (!queue) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: null,
      detail: `Queue binding ${bindingName} missing`,
    };
  }
  // Heartbeat message. The email consumer drops kind === 'probe' without
  // calling Resend. Success here just means send() resolved.
  await queue.send({ kind: "probe" });
  const latencyMs = Date.now() - started;
  return {
    componentId: component.id,
    status: "operational",
    latencyMs,
    detail: null,
  };
}

// ---- External (fed by webhook from /api/status-probe) ---------------------

function externalProbe(component: ComponentDef): ProbeResult {
  // The cron must not write `operational` for these — that would race the
  // webhook and could close incidents on a stale signal. `unknown` is treated
  // as neutral by the state machine (see runner.server.ts).
  return {
    componentId: component.id,
    status: "unknown",
    latencyMs: null,
    detail: "Awaiting external monitor result",
  };
}

// ---- Resend (manual-only for now) ----------------------------------------

function resendManualProbe(component: ComponentDef): ProbeResult {
  // TODO: synthetic send when Resend volume justifies the quota cost. For
  // now Resend has no public status feed we can poll, so this pill stays
  // unknown and we rely on the Queues probe to surface downstream breakage.
  return {
    componentId: component.id,
    status: "unknown",
    latencyMs: null,
    detail:
      "Resend publishes no status feed; monitored indirectly via the email queue.",
  };
}

// ---- Stripe status.json ---------------------------------------------------

type StripeStatusPayload = {
  status?: {
    indicator?: "none" | "minor" | "major" | "critical" | string;
    description?: string;
  };
  components?: Array<{
    name?: string;
    status?: string;
  }>;
};

let stripeStatusCache: {
  at: number;
  url: string;
  payload: StripeStatusPayload;
} | null = null;
const STRIPE_CACHE_TTL_MS = 60_000;

async function fetchStripeStatus(
  url: string,
): Promise<StripeStatusPayload> {
  if (
    stripeStatusCache &&
    stripeStatusCache.url === url &&
    Date.now() - stripeStatusCache.at < STRIPE_CACHE_TTL_MS
  ) {
    return stripeStatusCache.payload;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "PickupRoster-StatusProbe/1" },
    });
    if (!res.ok) {
      throw new Error(`status.json returned HTTP ${res.status}`);
    }
    const payload = (await res.json()) as StripeStatusPayload;
    stripeStatusCache = { at: Date.now(), url, payload };
    return payload;
  } finally {
    clearTimeout(t);
  }
}

function indicatorToStatus(
  indicator: string | undefined,
): ComponentStatus {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
    case "critical":
      return "outage";
    default:
      return "unknown";
  }
}

function componentStatusToStatus(
  componentStatus: string | undefined,
): ComponentStatus {
  if (!componentStatus) return "unknown";
  // Stripe publishes statuses like "operational", "degraded_performance",
  // "partial_outage", "major_outage", "under_maintenance".
  if (componentStatus === "operational") return "operational";
  if (componentStatus.includes("maintenance")) return "degraded";
  if (componentStatus.includes("degraded") || componentStatus === "partial_outage") {
    return "degraded";
  }
  if (componentStatus.includes("outage")) return "outage";
  return "unknown";
}

async function stripeStatusProbe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const envKey = String(component.config.statusUrlEnv ?? "STRIPE_STATUS_URL");
  const url =
    (env as unknown as Record<string, string | undefined>)[envKey] ??
    "https://www.stripe-status.com/api/v2/status.json";
  const payload = await fetchStripeStatus(url);
  const status = indicatorToStatus(payload.status?.indicator);
  return {
    componentId: component.id,
    status,
    latencyMs: Date.now() - started,
    detail: payload.status?.description ?? null,
  };
}

async function stripeComponentProbe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const envKey = String(component.config.statusUrlEnv ?? "STRIPE_STATUS_URL");
  const nameContains = String(component.config.nameContains ?? "");
  const url =
    (env as unknown as Record<string, string | undefined>)[envKey] ??
    "https://www.stripe-status.com/api/v2/status.json";

  const payload = await fetchStripeStatus(url);
  const match = (payload.components ?? []).find((c) =>
    (c.name ?? "").toLowerCase().includes(nameContains.toLowerCase()),
  );
  if (!match) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: Date.now() - started,
      detail: `no component matching "${nameContains}" in status.json`,
    };
  }
  return {
    componentId: component.id,
    status: componentStatusToStatus(match.status),
    latencyMs: Date.now() - started,
    detail: match.status ?? null,
  };
}

// ---- Tenants aggregate ----------------------------------------------------

async function tenantsAggregateProbe(
  component: ComponentDef,
  env: Env,
  started: number,
): Promise<ProbeResult> {
  const degradedRatio = Number(component.config.degradedRatio ?? 0.0);
  const outageRatio = Number(component.config.outageRatio ?? 0.4);

  const d1 = env.D1_DATABASE;
  if (!d1) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: null,
      detail: "D1_DATABASE binding missing",
    };
  }

  // TODO: this won't scale past ~500 orgs — switch to stratified random
  // sampling once we cross that. For now we probe every tenant each tick.
  const rows = await d1
    .prepare(`SELECT slug FROM "Org" WHERE slug IS NOT NULL`)
    .all<{ slug: string }>();
  const slugs = (rows.results ?? [])
    .map((r) => r.slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  if (slugs.length === 0) {
    return {
      componentId: component.id,
      status: "unknown",
      latencyMs: Date.now() - started,
      detail: "no tenant orgs found",
    };
  }

  // Anchor the probe URL on the deploy's PUBLIC_ROOT_DOMAIN so the staging
  // cron probes `*.staging.pickuproster.com`, not prod tenants. Falls back
  // to `pickuproster.com` if the env var is unset (older deploys).
  const publicRoot =
    (
      (env as unknown as Record<string, string | undefined>).PUBLIC_ROOT_DOMAIN ??
      ""
    )
      .trim()
      .toLowerCase() || "pickuproster.com";

  const results = await Promise.allSettled(
    slugs.map((slug) => probeTenantSubdomain(slug, publicRoot)),
  );
  const total = results.length;
  const fails = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value),
  ).length;

  const failRatio = fails / total;
  let rollup: ComponentStatus = "operational";
  if (failRatio > outageRatio) {
    rollup = "outage";
  } else if (fails > 0 && failRatio > degradedRatio) {
    rollup = "degraded";
  }

  return {
    componentId: component.id,
    status: rollup,
    latencyMs: Date.now() - started,
    detail: `${fails}/${total} tenant subdomains failing`,
  };
}

async function probeTenantSubdomain(
  slug: string,
  publicRoot: string,
): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${slug}.${publicRoot}/`, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "PickupRoster-StatusProbe/1" },
    });
    // Any 2xx/3xx counts as up. Redirects (e.g. to /login) are expected.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
