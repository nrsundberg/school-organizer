/// <reference types="@cloudflare/workers-types" />

export {};

declare global {
  interface Env {
    D1_DATABASE: D1Database;
    BINGO_BOARD: DurableObjectNamespace;
    SENTRY_DSN: string;
    SENTRY_RELEASE: string;
    ENVIRONMENT: string;
    BETTER_AUTH_SECRET: string;
    ORG_BRANDING_BUCKET: R2Bucket;
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
