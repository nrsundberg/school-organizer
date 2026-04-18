import { createRequestHandler, RouterContextProvider } from "react-router";
import { withSentry } from "@sentry/cloudflare";
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

      const serverMode =
        (env as any).ENVIRONMENT === "development"
          ? "development"
          : "production";
      return createRequestHandler(buildImport, serverMode)(request, context);
    },
  } satisfies ExportedHandler<Env>,
);
