import { createRequestHandler, RouterContextProvider } from "react-router";
import { getCurrentScope, withSentry } from "@sentry/cloudflare";
import { runPastDueSuspension } from "../app/domain/billing/past-due-suspension.server";
import { runTrialMaintenance } from "../app/domain/billing/trial-maintenance.server";
import { suspendExpiredTrialingOrgs } from "../app/domain/billing/trial-expiry.server";
import { runTrialEmailNotifications } from "../app/domain/email/trial-notifications.server";
import { handleEmailQueue } from "../app/domain/email/consumer.server";
import { pruneExpiredPasswordResetTokens } from "../app/domain/auth/password-reset.server";
import { runStatusProbes } from "../app/domain/status/runner.server";
import type { EmailMessage } from "../app/domain/email/types";
import {
  isMarketingHost,
  resolveTenantSlugFromHost,
} from "../app/domain/utils/host.server";
import { applySecurityHeaders } from "../app/lib/security-headers.server";
import { createCspNonce, CSP_NONCE_HEADER } from "../app/lib/csp";
export { BingoBoardDO } from "./bingo-board";

/**
 * Resolve the tenant orgId from the request host for the WebSocket upgrade
 * path, which runs *before* the React Router middleware (no context yet).
 *
 * Mirrors `resolveOrgByHost` in app/domain/utils/global-context.server.ts:
 *   1. Custom-domain match (e.g. tenant.example.com).
 *   2. Marketing hosts have no tenant → null.
 *   3. Slug from subdomain (e.g. tome.pickuproster.com → "tome").
 *
 * Uses raw D1 prepared statements to avoid the Prisma init cost on every
 * WebSocket upgrade. The host helpers from `host.server.ts` only read
 * env, so passing `{ cloudflare: { env } }` as the context shim works.
 */
async function resolveOrgIdFromHost(
  env: Env,
  request: Request
): Promise<string | null> {
  const ctxShim = { cloudflare: { env } };
  const host = new URL(request.url).host.toLowerCase().split(":")[0];

  // 1. Custom domain (highest priority — explicit per-tenant DNS).
  const byCustom = await env.D1_DATABASE.prepare(
    `SELECT id FROM "Org" WHERE customDomain = ? LIMIT 1`
  )
    .bind(host)
    .first<{ id: string }>();
  if (byCustom?.id) return byCustom.id;

  // 2. Marketing hosts have no tenant board.
  if (isMarketingHost(request, ctxShim)) return null;

  // 3. Tenant slug from subdomain.
  const slug = resolveTenantSlugFromHost(request, ctxShim);
  if (slug) {
    const bySlug = await env.D1_DATABASE.prepare(
      `SELECT id FROM "Org" WHERE slug = ? LIMIT 1`
    )
      .bind(slug)
      .first<{ id: string }>();
    if (bySlug?.id) return bySlug.id;
  }

  return null;
}

// @ts-expect-error - build output has no type declarations
const buildImport = () => import("../build/server/index.js");

export default withSentry(
  (env) => ({
    dsn: (env as any).SENTRY_DSN,
    release: (env as any).SENTRY_RELEASE,
    environment: (env as any).ENVIRONMENT ?? "production",
    tracesSampleRate: 0.1
  }),
  {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response> {
      const url = new URL(request.url);

      // Route WebSocket upgrades directly to the per-tenant Durable Object.
      // The DO is keyed by orgId so each tenant gets an isolated broadcast
      // channel and hibernation lifecycle. CF DOs are lazily materialized
      // on first .fetch(), so no signup-time provisioning is needed.
      if (
        url.pathname === "/ws" &&
        request.headers.get("Upgrade") === "websocket"
      ) {
        const orgId = await resolveOrgIdFromHost(env, request);
        if (!orgId) {
          // No tenant on this host (marketing, unknown subdomain, etc.) —
          // there is no live board to subscribe to.
          return new Response("Tenant not found for board WebSocket", {
            status: 404
          });
        }
        const id = env.BINGO_BOARD.idFromName(orgId);
        const stub = env.BINGO_BOARD.get(id);
        return stub.fetch(request);
      }

      // Bridge Cloudflare env bindings into process.env
      Object.assign(process.env, env);

      const cspNonce = createCspNonce();
      const requestWithNonceHeaders = new Headers(request.headers);
      requestWithNonceHeaders.set(CSP_NONCE_HEADER, cspNonce);
      const requestWithNonce = new Request(request, {
        headers: requestWithNonceHeaders
      });

      const context = new RouterContextProvider();
      (context as any).cloudflare = { env, ctx };

      try {
        const scope = getCurrentScope();
        scope.setTag("http.host", url.host);
        scope.setTag(
          "app.surface",
          isMarketingHost(requestWithNonce, context) ? "marketing" : "tenant"
        );
      } catch {
        // optional Sentry scope
      }

      const serverMode =
        (env as any).ENVIRONMENT === "development"
          ? "development"
          : "production";
      const response = await createRequestHandler(buildImport, serverMode)(
        requestWithNonce,
        context
      );
      // NB: the WebSocket upgrade branch above returns before reaching here,
      // so we never try to mutate a 101-switching-protocols response. The
      // `scheduled` and `queue` handlers also never pass through this path.
      return applySecurityHeaders(
        response,
        env as { ENVIRONMENT?: string },
        cspNonce
      );
    },

    async scheduled(
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ) {
      Object.assign(process.env, env);
      const context = new RouterContextProvider();
      (context as any).cloudflare = { env, ctx };

      // Dispatch on the cron expression. Each branch is wrapped in its own
      // try/catch so a probe blip cannot break the daily billing cron, and
      // vice-versa.
      if (controller.cron === "*/2 * * * *") {
        try {
          await runStatusProbes(context);
        } catch (e) {
          console.error("scheduled status probes failed", e);
          // Swallow: the status page is best-effort; we don't want a failed
          // tick to bubble and trigger alarm storms.
        }
        return;
      }

      // Default: daily billing + lifecycle email maintenance (0 10 * * *).
      try {
        await runTrialMaintenance(context);
        // Flip trialing orgs whose 30-day trial has ended into SUSPENDED so
        // the "Billing Action Required" screen kicks in. Idempotent — orgs
        // already in non-TRIALING statuses are skipped.
        try {
          const res = await suspendExpiredTrialingOrgs(context);
          if (res.suspended > 0) {
            console.log(
              `[cron] suspended ${res.suspended} expired trialing org(s) (checked ${res.checked}).`
            );
          }
        } catch (e) {
          console.error("trial-expiry suspension failed", e);
        }
        await runPastDueSuspension(context);
        // Enqueue lifecycle emails (mid-trial check-in + 7/3/1-day trial
        // expiring). Idempotent via the SentEmail table.
        await runTrialEmailNotifications(context);
        // Drop password-reset tokens whose expiresAt is older than 7 days.
        // Recent expired/used rows are kept for forensic lookups.
        try {
          const pruned = await pruneExpiredPasswordResetTokens(context);
          if (pruned > 0) {
            console.log(
              `[cron] pruned ${pruned} expired password-reset token(s).`
            );
          }
        } catch (e) {
          console.error("password-reset token prune failed", e);
          // Isolated: cleanup failure shouldn't break the rest of the cron.
        }
      } catch (e) {
        console.error("scheduled billing maintenance failed", e);
        throw e;
      }
    },

    /**
     * EMAIL_QUEUE consumer. Registered via wrangler.jsonc `queues.consumers`.
     * Each message is an EmailMessage — handler renders the template and
     * dispatches to Resend.
     */
    async queue(
      batch: MessageBatch<EmailMessage>,
      env: Env,
      _ctx: ExecutionContext
    ) {
      Object.assign(process.env, env);
      await handleEmailQueue(batch, env);
    }
  } satisfies ExportedHandler<Env, EmailMessage>
);
