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
  // These three components are fed by an external uptime monitor (UptimeRobot
  // / Cloudflare Health Checks) that POSTs to /api/status-probe. They were
  // previously cron-driven HTTP probes against the worker's own zone, which
  // returned 522 on every tick because of Cloudflare's same-zone loopback.
  // See docs/status-page-monitor.md for monitor configuration.
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
  // Externally probed against a canary tenant subdomain. The previous cron
  // implementation fanned out a fetch per tenant, all hitting the same zone
  // and receiving 522 from the loopback — see notes on the application-section
  // components above.
  {
    id: "tenants_aggregate",
    section: "tenants",
    name: "Tenant boards",
    description: "Canary probe of a representative tenant subdomain",
    probe: "external",
    config: {},
  },
];
