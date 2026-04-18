# Prisma tenant-scoping extension for multi-tenant SaaS

## Context

We're moving from a single-school app (Tome) to a multi-tenant SaaS where each school is an `Org` with its own students/teachers/spaces/events. A Worker middleware resolves `request.headers.host` → `orgId` and sets it in request context. Every Prisma query against a tenant-scoped model must be filtered by that `orgId`, and every insert must stamp it.

Writing `where: { orgId }` in hundreds of query sites is fragile — one miss leaks data between schools. The fix is a Prisma **client extension** (`$extends` with a `query` component) that automatically injects the filter at the query layer. This doc shows the shape of that extension, how it plugs into `getPrisma`, and the schema changes it depends on.

## Schema additions

Add a global `Org` table and an `orgId` foreign key on every tenant-scoped model. Tenant-scoped models in the current schema: `Teacher`, `Student`, `Space`, `CallEvent`, `AppSettings`, `ViewerAccessAttempt`, `ViewerAccessSession`, `ViewerMagicLink`. **Not** tenant-scoped: `User`, `Session`, `Account`, `Verification` — these are better-auth tables that use better-auth's own organization plugin for multi-org membership; the extension skips them.

```prisma
model Org {
  id               String   @id @default(cuid())
  slug             String   @unique        // e.g. "tome" → tome.yoursaas.com
  customDomain     String?  @unique        // e.g. "carline.tomeschool.org"
  name             String
  brandColor       String?
  logoUrl          String?
  status           String   @default("active") // active | past_due | canceled
  stripeCustomerId String?
  createdAt        DateTime @default(now())
}

model Student {
  id     Int    @id @default(autoincrement())
  orgId  String
  org    Org    @relation(fields: [orgId], references: [id])
  // …existing fields
  @@index([orgId])
  @@index([orgId, homeRoom])  // compound indexes on orgId + existing query columns
}
// …same pattern for Teacher, Space, CallEvent, AppSettings, ViewerAccessAttempt, etc.
```

`AppSettings.id` drops the singleton `"default"` contract — now it's keyed by `orgId` (one settings row per org).

## The extension

New file: `app/db/tenant-extension.ts`.

```ts
import { Prisma } from "~/db";

// Tenant-scoped model names. Keep this list authoritative.
const TENANT_MODELS = new Set<Prisma.ModelName>([
  "Teacher",
  "Student",
  "Space",
  "CallEvent",
  "AppSettings",
  "ViewerAccessAttempt",
  "ViewerAccessSession",
  "ViewerMagicLink",
]);

// Reads: operations that accept `where` and should be filtered.
const READ_OPS = new Set([
  "findFirst", "findFirstOrThrow",
  "findMany",
  "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
]);

// Writes that create rows — need orgId injected into `data`.
const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

// Single-row writes — need `where` filtered AND (for upsert) data stamped.
const UPDATE_OPS = new Set(["update", "delete", "upsert"]);

export function tenantExtension(orgId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: "tenant-scope",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_MODELS.has(model)) return query(args);

            const a = args as any;

            if (READ_OPS.has(operation)) {
              a.where = { AND: [a.where ?? {}, { orgId }] };
            }

            if (UPDATE_OPS.has(operation) && a.where) {
              a.where = { AND: [a.where, { orgId }] };
            }

            if (CREATE_OPS.has(operation)) {
              if (operation === "createMany") {
                a.data = (a.data as any[]).map((d) => ({ ...d, orgId }));
              } else if (operation === "upsert") {
                a.create = { ...a.create, orgId };
                // update branch can't change orgId; leave as-is
              } else {
                a.data = { ...a.data, orgId };
              }
            }

            return query(a);
          },
        },
      },
    }),
  );
}
```

### Why `$allOperations` and not per-operation hooks

- One place to add future operations (e.g. `findRaw`).
- `findUnique` with a `where` clause that's *only* a unique key (e.g. `{ id: 5 }`) still gets the `orgId` AND'd in — which is exactly what we want; a cross-tenant `findUnique` by PK becomes a miss instead of a leak.

### Gotchas the extension does NOT cover

1. **Raw SQL**: `$queryRaw` / `$executeRaw` bypass query extensions. Policy: forbid raw SQL on tenant-scoped tables; if absolutely needed, require an explicit `AND "orgId" = ${orgId}` clause and add a lint rule.
2. **Nested writes via relations**: `prisma.student.create({ data: { callEvents: { create: { ... } } } })` — the nested `CallEvent` create doesn't get `orgId` stamped by our extension (extension fires per top-level op). Two options: (a) ban nested tenant-scoped creates, or (b) add a recursive walker. Start with (a); it's rare in this codebase.
3. **`connect` / `connectOrCreate`**: connecting to a different tenant's row would succeed at the DB level since FKs are opaque. Prisma's `connect` doesn't filter by `orgId`. Mitigation: DB-level check constraint `orgId = referenced.orgId` on relations that cross tenant-scoped tables (e.g. `CallEvent.spaceNumber → Space`), enforced at app layer via a test.
4. **Better-auth tables**: excluded from `TENANT_MODELS`. User↔Org membership is handled separately by better-auth's organization plugin (its own `Member` table).

## Wiring into `getPrisma`

Update `app/db.server.ts`:

```ts
export function getPrisma(context: any, orgId?: string) {
  // …existing D1 adapter setup…
  const base = new PrismaClient({ adapter });
  if (!orgId) return base; // admin/cross-tenant access only
  return base.$extends(tenantExtension(orgId));
}
```

Current module-level cache (`cachedPrisma`) keys on the D1 binding; with the extension we should cache per-`orgId` as well (`Map<orgId, ExtendedClient>`) or just drop caching for extended clients — re-wrapping is cheap.

## Middleware changes

`app/domain/utils/global-context.server.ts` — add an `orgContext` and resolve before user lookup:

```ts
export const orgContext = createContext<Org | null>(null);

// in globalStorageMiddleware, before auth:
const host = new URL(request.url).host;
const org = await resolveOrgByHost(baseDb, host);
if (!org || org.status !== "active") throw redirect("/inactive");
context.set(orgContext, org);

// then when building the tenant-scoped client:
const db = getPrisma(context, org.id);
```

`resolveOrgByHost` matches `customDomain` first, then falls back to `<slug>.yoursaas.com`. Cache in memory per-isolate with a short TTL.

Every `getPrisma(context)` call site (~20 files) changes to `getPrisma(context, org.id)` — cleanest done with a thin helper `getTenantPrisma(context)` that reads `orgContext` and calls through.

## Files to touch

- `prisma/schema.prisma` — add `Org`, add `orgId` + index to each tenant-scoped model, migration
- `app/db/tenant-extension.ts` — new file, the extension above
- `app/db.server.ts` — accept optional `orgId`, wrap with extension
- `app/domain/utils/global-context.server.ts` — add `orgContext`, resolve by host
- `app/routes/**/*.{ts,tsx}` — swap `getPrisma(context)` → `getTenantPrisma(context)` at every call site
- Data migration: seed a single `Org` row for Tome, backfill `orgId` on all existing rows

## Verification

1. **Isolation test** (critical): unit test that seeds two orgs, inserts a `Student` into each, opens a scoped client for org A, asserts `findMany()` never returns org B's rows — across all read operations in `READ_OPS`.
2. **Write stamping**: create/createMany/upsert tests that assert `orgId` is set automatically and cannot be overridden by caller.
3. **Cross-tenant `findUnique`**: asserts `findUnique({ where: { id: <org-B-id> } })` from an org-A client returns `null`, not the row.
4. **Nested write ban**: test that a nested create on a tenant-scoped relation either fails loudly or gets `orgId` injected (depending on which path we take).
5. **End-to-end**: `wrangler dev`, set up two `Org` rows (`tome` + `fake-school`) with different `Students`, hit `tome.localhost:8787/admin/print/master` and `fake.localhost:8787/admin/print/master` — each shows only its own roster.
6. Grep for `$queryRaw` / `$executeRaw` — none should exist on tenant-scoped tables.

## Out of scope for this doc

- Stripe billing/webhooks
- Cloudflare for SaaS custom-domain provisioning
- Branding (colors, logo) rendering
- Durable Object instance naming (will be `orgId`-based, tracked separately)
- better-auth organization plugin wiring
