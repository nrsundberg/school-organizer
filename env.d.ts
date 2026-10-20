/// <reference types="@cloudflare/workers-types" />

export {};

declare global {
  interface Env {
    D1_DATABASE: D1Database;
    /** Rate limiter for /login and /signup actions (10 req / 60 s per IP) */
    RL_AUTH: RateLimit;
    /** Rate limiter for /api/billing/checkout and /api/billing/portal (20 req / 60 s per org/IP) */
    RL_BILLING: RateLimit;
    /** Help chat (20 req / 60 s per IP and per browser session) */
    RL_HELP: RateLimit;
    /** Contact form and chat escalation (5 req / 60 s per IP) */
    RL_CONTACT: RateLimit;
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
    /** Stripe recurring annual price for Campus ($4,800/year). Required for annual checkout. */
    STRIPE_CAMPUS_ANNUAL_PRICE_ID?: string;
    /**
     * Optional override for the intro-call page. When unset, links use
     * https://<PUBLIC_ROOT_DOMAIN>/book/intro.
     */
    INTRO_CALL_BOOKING_URL?: string;
    /**
     * Optional override for the demo page. When unset, links use
     * https://<PUBLIC_ROOT_DOMAIN>/demo.
     */
    DEMO_BOOKING_URL?: string;
    /** Public Turnstile site key. The widget is hidden when this is unset. */
    TURNSTILE_SITE_KEY?: string;
    /**
     * Turnstile secret. `wrangler secret put TURNSTILE_SECRET_KEY`.
     * Verification is skipped only when this is missing outside production
     * and staging.
     */
    TURNSTILE_SECRET_KEY?: string;
    /**
     * Comma-separated hostnames Siteverify must return. Defaults to the
     * apex and www of PUBLIC_ROOT_DOMAIN.
     */
    TURNSTILE_HOSTNAMES?: string;
    /**
     * Zoom room added to the calendar invite LOCATION and body, labeled
     * "Join Zoom meeting". When unset, the email says Noah will send a Zoom link.
     */
    ZOOM_MEETING_URL?: string;
    /** Fallback when `ZOOM_MEETING_URL` is unset. */
    MEETING_URL?: string;
    /** HMAC secret for cancel/reschedule links. Falls back to BETTER_AUTH_SECRET. */
    BOOKING_TOKEN_SECRET?: string;
    /** IANA zone for the bookable grid. Default America/Denver. */
    BOOKING_TIMEZONE?: string;
    /** First hour of the grid, 0–23. Default 9. */
    BOOKING_START_HOUR?: string;
    /** Hour the grid ends (meetings must finish by this hour). Default 16. */
    BOOKING_END_HOUR?: string;
    /** ISO weekdays, Monday = 1. Default 1,2,3,4,5. */
    BOOKING_WEEKDAYS?: string;
    /** Meeting length in minutes. Default 30. */
    BOOKING_SLOT_MINUTES?: string;
    /** Gap after each meeting, in minutes. Default 15. */
    BOOKING_BUFFER_MINUTES?: string;
    /** Minimum notice in hours. Default 12. */
    BOOKING_MIN_NOTICE_HOURS?: string;
    /** How many days ahead a visitor can book. Default 21. */
    BOOKING_HORIZON_DAYS?: string;
    /** Max confirmed bookings per schedule-zone day, per kind. Default 8. */
    BOOKING_MAX_PER_DAY?: string;
    /**
     * Inbox for trial-start notifications. Defaults to NoahSundberg@gmail.com.
     */
    SIGNUP_NOTIFY_EMAIL?: string;
    /** @deprecated Use STRIPE_CAR_LINE_PRICE_ID + STRIPE_CAMPUS_PRICE_ID; dev fallback for both. */
    STRIPE_STARTER_PRICE_ID?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** Support email shown in footer/error pages; defaults to support@pickuproster.com when unset. */
    SUPPORT_EMAIL?: string;
    /**
     * Inbox for new help-chat and contact-form tickets.
     * Defaults to NoahSundberg@gmail.com when unset.
     */
    SUPPORT_NOTIFY_EMAIL?: string;
    /**
     * Anthropic API key for the help chat. Worker secret — never commit a value.
     * `wrangler secret put ANTHROPIC_API_KEY` (and `--env staging` / `--env production`).
     * Chat replies are disabled when this is missing; the contact form still works.
     */
    ANTHROPIC_API_KEY?: string;
    /**
     * Messages API model id. Defaults to claude-haiku-5-5.
     * Set as a Worker var (not a secret) when you want a different model.
     */
    ANTHROPIC_MODEL?: string;
    /** Resend API key (Worker secret). Required for email sends. */
    RESEND_API_KEY: string;
    /** Producer binding for outbound email queue (see wrangler.jsonc `queues.producers`). */
    EMAIL_QUEUE: Queue<import("./app/domain/email/types").EmailMessage>;
    /**
     * Public Stripe status feed. Overridable per-env so tests/previews can
     * point at a fixture. Defaults to https://www.stripe-status.com/api/v2/status.json.
     */
    STRIPE_STATUS_URL?: string;
    /**
     * Worker secret used to sign the BingoBoardDO presence-snapshot
     * loopback POST to `/api/drill-runs/:runId/presence-sample`. Both the
     * DO and the route share this secret; the route rejects requests
     * whose HMAC doesn't verify (or whose `timestamp` is more than 60s
     * skewed). Set with `wrangler secret put PRESENCE_SAMPLE_HMAC_SECRET`
     * for prod and staging. Without it, the alarm silently no-ops (so
     * the relay path keeps working in dev / local-only setups).
     */
    PRESENCE_SAMPLE_HMAC_SECRET?: string;
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
