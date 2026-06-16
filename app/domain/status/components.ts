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
  // Active cron HTTP probes against the deploy's own public root domain
  // (env.PUBLIC_ROOT_DOMAIN). A Cloudflare Worker fetching its own zone can
  // loop back through the edge and return a 520–527 edge error even when the
  // app is healthy; httpProbe maps that band to "unknown" (inconclusive)
  // rather than "outage" so a same-zone loopback degrades to gray, never a
  // false outage. A fresh /api/status-probe webhook row still wins because the
  // read service takes the latest row by timestamp.
  {
    id: "marketing",
    section: "application",
    name: "Marketing site",
    description: "pickuproster.com landing + public pages",
    probe: "http",
    config: { path: "/", expectStatus: 200, expectSubstring: "Pickup Roster" },
  },
  {
    id: "auth",
    section: "application",
    name: "Auth",
    description: "Login + session service",
    probe: "http",
    config: { path: "/login", expectStatus: 200 },
  },
  {
    id: "app_workers",
    section: "application",
    name: "App workers",
    description: "Cloudflare Workers serving the app",
    probe: "http",
    config: { path: "/api/healthz", expectStatus: 200, expectSubstring: "\"ok\":true" },
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
  // Active cron aggregate probe that fans out a fetch per tenant subdomain on
  // PUBLIC_ROOT_DOMAIN. Same-zone loopback 520–527 responses are treated as
  // inconclusive (not failures); if too few tenants return a conclusive
  // up/down the rollup degrades to "unknown" rather than a false "outage".
  {
    id: "tenants_aggregate",
    section: "tenants",
    name: "Tenant boards",
    description: "Canary probe of a representative tenant subdomain",
    probe: "tenants_aggregate",
    config: {},
  },
];
