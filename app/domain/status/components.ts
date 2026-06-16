import type { ComponentDef } from "./types";

/**
 * Static registry of every component displayed on /status. Each entry declares
 * a probe kind + probe-specific config consumed by probes.server.ts. The order
 * here is the display order within each section.
 *
 * To add a new component: append here, add a handler in probes.server.ts, and
 * add the pill's colour/meaning story in the UI as needed.
 */
export const COMPONENTS: ComponentDef[] = [
  // Application section.
  //
  // Fed by an external uptime monitor (UptimeRobot) that POSTs to
  // /api/status-probe. NOT cron-probed: a Cloudflare Worker cannot reliably
  // fetch its own zone apex — same-zone subrequests loop back through the edge
  // and time out (522), so a cron probe would write false "unknown" rows every
  // tick and clobber the webhook's operational signal. The read-side staleness
  // guard turns a silent monitor into honest gray, never a false outage. See
  // docs/status-page-monitor.md.
  {
    id: "marketing",
    section: "application",
    name: "Marketing site",
    description: "pickuproster.com landing + public pages",
    probe: "external",
    config: {},
  },
  {
    id: "auth",
    section: "application",
    name: "Auth",
    description: "Login + session service",
    probe: "external",
    config: {},
  },
  {
    id: "app_workers",
    section: "application",
    name: "App workers",
    description: "Cloudflare Workers serving the app",
    probe: "external",
    config: {},
  },

  // Data section
  {
    id: "d1",
    section: "data",
    name: "D1 database",
    description: "Primary app database",
    probe: "d1",
    config: {},
  },
  {
    id: "r2",
    section: "data",
    name: "R2 object storage",
    description: "Org branding assets",
    probe: "r2",
    config: {
      bucketBinding: "ORG_BRANDING_BUCKET",
      sentinelKey: ".status-probe",
    },
  },
  {
    id: "queues",
    section: "data",
    name: "Cloudflare Queues",
    description: "Outbound email queue (heartbeat)",
    probe: "queue",
    config: {
      queueBinding: "EMAIL_QUEUE",
    },
  },

  // Email section
  {
    id: "resend",
    section: "email",
    name: "Resend",
    description:
      "Outbound transactional mail. No public status feed — we infer outages from the queue backlog.",
    probe: "resend_manual",
    config: {},
  },

  // Payments section
  {
    id: "stripe_api",
    section: "payments",
    name: "Stripe API",
    description: "Billing and subscription processing",
    probe: "stripe_status",
    config: {
      statusUrlEnv: "STRIPE_STATUS_URL",
    },
  },
  {
    id: "stripe_connect",
    section: "payments",
    name: "Stripe Connect",
    description: "Connected-account flows",
    probe: "stripe_status_component",
    config: {
      statusUrlEnv: "STRIPE_STATUS_URL",
      nameContains: "Connect",
    },
  },

  // Tenants section.
  //
  // Fed by the external uptime monitor (UptimeRobot), same as the application
  // components above. A cron aggregate probe was tried and confirmed unusable:
  // the worker fanning out fetches to its own *.PUBLIC_ROOT_DOMAIN subdomains
  // hits the same same-zone loopback as the apex — the subrequests time out and
  // count as failures, reporting a false outage even when every tenant board is
  // healthy from the outside. An off-box monitor is the only reliable signal.
  // The tenantsAggregateProbe code is retained in probes.server.ts for a future
  // environment where same-zone fetches resolve. See docs/status-page-monitor.md.
  {
    id: "tenants_aggregate",
    section: "tenants",
    name: "Tenant boards",
    description: "Canary probe of a representative tenant subdomain",
    probe: "external",
    config: {},
  },
];
