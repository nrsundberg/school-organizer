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
import { isMarketingHost } from "../app/domain/utils/host.server";
import { applySecurityHeaders } from "../app/lib/security-headers.server";
export { BingoBoardDO } from "./bingo-board";

// @ts-expect-error - build output has no type declarations
const buildImport = () => import("../build/server/index.js");

export default withSentry(
  (env) => ({
    dsn: (env as any).SENTRY_DSN,
    release: (env as any).SENTRY_RELEASE,
    environment: (env as any).ENVIRONMENT ?? "production",
    tracesSampleRate: 0.1,
  }),
  {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const url = new URL(request.url);

      // Route WebSocket upgrades directly to the Durable Object
      if (
        url.pathname === "/ws" &&
        request.headers.get("Upgrade") === "websocket"
      ) {
        const id = env.BINGO_BOARD.idFromName("main");
        const stub = env.BINGO_BOARD.get(id);
        return stub.fetch(request);
      }

      // Bridge Cloudflare env bindings into process.env
      Object.assign(process.env, env);

      const context = new RouterContextProvider();
      (context as any).cloudflare = { env, ctx };

      try {
        const scope = getCurrentScope();
        scope.setTag("http.host", url.host);
        scope.setTag("app.surface", isMarketingHost(request, context) ? "marketing" : "tenant");
      } catch {
        // optional Sentry scope
      }

      const serverMode =
        (env as any).ENVIRONMENT === "development"
          ? "development"
          : "production";
      const response = await createRequestHandler(buildImport, serverMode)(
        request,
        context,
      );
      // NB: the WebSocket upgrade branch above returns before reaching here,
      // so we never try to mutate a 101-switching-protocols response. The
      // `scheduled` and `queue` handlers also never pass through this path.
      return applySecurityHeaders(response, env as { ENVIRONMENT?: string });
    },

    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
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
              `[cron] suspended ${res.suspended} expired trialing org(s) (checked ${res.checked}).`,
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
            console.log(`[cron] pruned ${pruned} expired password-reset token(s).`);
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
    async queue(batch: MessageBatch<EmailMessage>, env: Env, _ctx: ExecutionContext) {
      Object.assign(process.env, env);
      await handleEmailQueue(batch, env);
    },
  } satisfies ExportedHandler<Env, EmailMessage>,
);
