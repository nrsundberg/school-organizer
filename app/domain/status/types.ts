/**
 * Public status page types.
 *
 * ComponentStatus is the small enum rendered as a pill on /status. We never
 * surface latency numbers publicly — `latencyMs` is recorded on StatusCheck
 * rows for internal diagnostics only (see types.ts for types that leak vs
 * stay server-side).
 */

export type ComponentStatus =
  | "operational"
  | "degraded"
  | "outage"
  | "unknown";

export type IncidentSeverity = "degraded" | "outage";

export type SectionId =
  | "application"
  | "data"
  | "email"
  | "payments"
  | "tenants";

export type ComponentId =
  | "marketing"
  | "auth"
  | "app_workers"
  | "d1"
  | "r2"
  | "queues"
  | "resend"
  | "stripe_api"
  | "stripe_connect"
  | "tenants_aggregate";

export type ProbeKind =
  | "http"
  | "d1"
  | "r2"
  | "queue"
  | "resend_manual"
  | "stripe_status"
  | "stripe_status_component"
  | "tenants_aggregate"
  // Component is fed by an external uptime monitor that POSTs to
  // /api/status-probe. The cron-side `runProbe` returns "unknown" so
  // it doesn't drown the webhook signal with stale operational rows.
  | "external";

export type ComponentDef = {
  id: ComponentId;
  section: SectionId;
  name: string;
  description: string;
  probe: ProbeKind;
  /** Free-form config per probe kind. Interpreted by probes.server.ts. */
  config: Record<string, unknown>;
};

/** Result of a single probe run — becomes a StatusCheck row. */
export type ProbeResult = {
  componentId: ComponentId;
  status: ComponentStatus;
  latencyMs: number | null;
  detail: string | null;
};

/** Day-rollup entry for the 90-day uptime grid. */
export type UptimeDay = {
  /** ISO date string (UTC, YYYY-MM-DD). */
  date: string;
  /** Worst status seen for that day; 'unknown' when there were no checks. */
  status: ComponentStatus;
};

export type StatusPageComponent = {
  id: ComponentId;
  section: SectionId;
  name: string;
  description: string;
  currentStatus: ComponentStatus;
  /** Optional public-facing note (e.g. Resend "monitored indirectly"). */
  note: string | null;
  /** Length-90 array, most-recent day last. */
  uptime90d: UptimeDay[];
};

export type ActiveIncident = {
  id: string;
  componentId: ComponentId;
  componentName: string;
  severity: IncidentSeverity;
  title: string;
  startedAt: string;
};
