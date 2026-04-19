import { createRequestHandler, RouterContextProvider } from "react-router";
import { getCurrentScope, withSentry } from "@sentry/cloudflare";
import { runPastDueSuspension } from "../app/domain/billing/past-due-suspension.server";
import { runTrialMaintenance } from "../app/domain/billing/trial-maintenance.server";
import { isMarketingHost } from "../app/domain/utils/host.server";
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
      return createRequestHandler(buildImport, serverMode)(request, context);
    },

    async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
      Object.assign(process.env, env);
      const context = new RouterContextProvider();
      (context as any).cloudflare = { env, ctx };
      try {
        await runTrialMaintenance(context);
        await runPastDueSuspension(context);
      } catch (e) {
        console.error("scheduled billing maintenance failed", e);
        throw e;
      }
    },
  } satisfies ExportedHandler<Env>,
);
