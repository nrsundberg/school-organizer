/// <reference types="@cloudflare/workers-types" />

export {};

declare global {
  interface Env {
    D1_DATABASE: D1Database;
    /** Rate limiter for /login and /signup actions (10 req / 60 s per IP) */
    RL_AUTH: RateLimit;
    /** Rate limiter for /api/billing/checkout and /api/billing/portal (20 req / 60 s per org/IP) */
    RL_BILLING: RateLimit;
    BINGO_BOARD: DurableObjectNamespace;
    SENTRY_DSN: string;
    SENTRY_RELEASE: string;
    ENVIRONMENT: string;
    BETTER_AUTH_SECRET: string;
    ORG_BRANDING_BUCKET: R2Bucket;
    /** e.g. pickuproster.com — apex and www are marketing; {slug}.domain is tenant */
    PUBLIC_ROOT_DOMAIN: string;
    /** Comma-separated extra marketing hosts (e.g. localhost,127.0.0.1) */
    MARKETING_HOSTS: string;
    /** Comma-separated emails that may access /platform when role is not PLATFORM_ADMIN */
    PLATFORM_ADMIN_EMAILS: string;
    /** Stripe recurring price for Car Line plan (optional if using legacy STRIPE_STARTER_PRICE_ID for dev). */
    STRIPE_CAR_LINE_PRICE_ID?: string;
    /** Stripe recurring annual price for Car Line plan (optional). */
    STRIPE_CAR_LINE_ANNUAL_PRICE_ID?: string;
    /** Stripe recurring price for Campus plan. */
    STRIPE_CAMPUS_PRICE_ID?: string;
    /** Stripe recurring annual price for Campus plan (optional). */
    STRIPE_CAMPUS_ANNUAL_PRICE_ID?: string;
    /** @deprecated Use STRIPE_CAR_LINE_PRICE_ID + STRIPE_CAMPUS_PRICE_ID; dev fallback for both. */
    STRIPE_STARTER_PRICE_ID?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** Support email shown in footer/error pages; defaults to support@pickuproster.com when unset. */
    SUPPORT_EMAIL?: string;
    /** Resend API key (Worker secret). Required for email sends. */
    RESEND_API_KEY: string;
    /** Producer binding for outbound email queue (see wrangler.jsonc `queues.producers`). */
    EMAIL_QUEUE: Queue<import("./app/domain/email/types").EmailMessage>;
    /**
     * Public Stripe status feed. Overridable per-env so tests/previews can
     * point at a fixture. Defaults to https://www.stripe-status.com/api/v2/status.json.
     */
    STRIPE_STATUS_URL?: string;
  }
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}
