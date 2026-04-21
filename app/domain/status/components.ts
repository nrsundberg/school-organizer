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
  // Application section
  {
    id: "marketing",
    section: "application",
    name: "Marketing site",
    description: "pickuproster.com landing + public pages",
    probe: "http",
    config: {
      url: "https://pickuproster.com/",
      expectStatus: 200,
      // Looking for a known-stable string in the landing body. Updating the
      // marketing hero? Update this too.
      expectSubstring: "Pickup Roster",
    },
  },
  {
    id: "auth",
    section: "application",
    name: "Auth",
    description: "Login + session service",
    probe: "http",
    config: {
      // The login page is a stable public endpoint that exercises session
      // middleware + DB read. If we add a dedicated /api/auth/ok health
      // endpoint later, point this at that instead.
      url: "https://pickuproster.com/login",
      expectStatus: 200,
    },
  },
  {
    id: "app_workers",
    section: "application",
    name: "App workers",
    description: "Cloudflare Workers serving the app",
    probe: "http",
    config: {
      url: "https://pickuproster.com/api/healthz",
      expectStatus: 200,
      expectSubstring: '"ok":true',
    },
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

  // Tenants section
  {
    id: "tenants_aggregate",
    section: "tenants",
    name: "Tenant boards",
    description: "Aggregate of {slug}.pickuproster.com tenant subdomains",
    probe: "tenants_aggregate",
    config: {
      // Thresholds for the rollup: degraded if 1-40% fail, outage if >40% fail.
      degradedRatio: 0.0,
      outageRatio: 0.4,
    },
  },
];
