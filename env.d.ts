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
    /** e.g. schoolorganizer.com — apex and www are marketing; {slug}.domain is tenant */
    PUBLIC_ROOT_DOMAIN: string;
    /** Comma-separated extra marketing hosts (e.g. localhost,127.0.0.1) */
    MARKETING_HOSTS: string;
    /** Comma-separated emails that may access /platform when role is not PLATFORM_ADMIN */
    PLATFORM_ADMIN_EMAILS: string;
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
