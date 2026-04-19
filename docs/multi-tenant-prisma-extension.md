# Multi-tenant Prisma on Cloudflare D1

This document describes how **school-scoped data** is isolated per organization (`Org`) in this repo: schema shape, the Prisma **client extension**, request wiring, and operational limits.

## Model split

| Category | Models | Scoping |
|----------|--------|---------|
| **Tenant (school) data** | `Teacher`, `Student`, `Space`, `CallEvent`, `AppSettings`, `ViewerAccessAttempt`, `ViewerAccessSession`, `ViewerMagicLink` | Every row has `orgId` → `Org`. Queries go through **`getTenantPrisma`** so the extension enforces `orgId`. |
| **Global / auth** | `User`, `Session`, `Account`, `Verification` | Not wrapped by the tenant extension. `User` may have `orgId` for membership, but user/session queries use **`getPrisma(context)`** without the extension. |
| **Global app data** | `Org`, `StripeWebhookEvent` | No `orgId` filter; resolved or processed explicitly. |

Authoritative schema: `prisma/schema.prisma`.

## Request flow

1. **`globalStorageMiddleware`** (`app/domain/utils/global-context.server.ts`) runs on each request.
2. **`resolveOrgByHost`** loads an `Org` from the **unscoped** client: match `customDomain` to the request host, else match `slug` to the first DNS label (e.g. `tome.example.com` → `slug: "tome"`).
3. If no org is found but the signed-in user has `user.orgId`, the org is loaded from that id.
4. **`orgContext`** stores the current `Org | null`; **`getTenantPrisma(context)`** reads it and calls `getPrisma(context, org.id)`.

Routes that work with roster, spaces, viewer tables, etc. should use **`getTenantPrisma`**. Cross-tenant or auth-only code uses **`getPrisma(context)`** without a second argument.

## Prisma client extension

Implementation: **`app/db/tenant-extension.ts`**.

- **`tenantExtension(orgId)`** uses `Prisma.defineExtension` with `$allModels` / `$allOperations`.
- For tenant models, it:
  - **AND**s `{ orgId }` onto `where` for reads (`findMany`, `count`, `aggregate`, `updateMany`, …) and for single-row `update` / `delete` / `upsert`.
  - **Sets** `orgId` on `create`, `createMany`, and `upsert`’s `create` payload.

Excluded models are unchanged, so `getPrisma(context)` remains valid for `User`, `Org`, webhooks, etc.

## Server entrypoints

| Module | Role |
|--------|------|
| `app/db.server.ts` | Cloudflare Worker: `PrismaD1` adapter, optional `tenantExtension(orgId)`. |
| `app/db.local.server.ts` | Vite dev: LibSQL adapter + same extension; swapped in via `vite.config.ts` alias for `~/db.server`. |

The base `PrismaClient` instance is cached per D1 binding; extending with `tenantExtension(orgId)` happens per request when `orgId` is passed.

## What the extension does **not** guarantee

1. **`$queryRaw` / `$executeRaw`** — bypass Prisma’s query layer. Avoid raw SQL on tenant tables, or always include an explicit `orgId` predicate.
2. **Nested creates** on relations (e.g. `student.create({ data: { callEvents: { create: … } } })`) — nested creates may not receive automatic `orgId` from this extension. Prefer flat creates or explicit `orgId` on nested payloads.
3. **`connect` / `connectOrCreate`** — FKs do not enforce tenant match; validate at the application layer or with tests.

## Migrations and D1

- SQL migrations live under **`migrations/`** (see `wrangler.jsonc` → `migrations_dir`).
- Prisma schema is the source of truth for the client; apply remote D1 migrations with:

  ```sh
  npm run d1:migrate
  ```

## Verification checklist

- [ ] Two orgs in D1; tenant-scoped queries from org A never return org B’s rows (`findMany`, `findUnique`, etc.).
- [ ] `create` / `createMany` rows get the correct `orgId` without callers passing it (for routes using `getTenantPrisma`).
- [ ] Grep for `$queryRaw` / `$executeRaw` on tenant paths and audit.

## Local testing with multiple hosts

With **`npm run dev:worker`**, you can seed two `Org` rows (different `slug` / `customDomain`) and hit the app on different hosts (e.g. via `/etc/hosts` or `*.localhost`) to confirm rosters and admin routes stay isolated per org.
