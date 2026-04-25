/**
 * Seeded-tenant Playwright fixture — stands up an isolated Org + admin
 * User + logged-in Session + AppSettings (with hashed viewer PIN) +
 * one HomeRoom + one Space for each spec that extends it.
 *
 * Usage:
 *
 *   import { test, expect } from "./fixtures/seeded-tenant";
 *   // or, from a sibling directory:
 *   import { test, expect } from "../fixtures/seeded-tenant";
 *
 *   test("does the admin thing", async ({ page, tenant }) => {
 *     await page.context().addCookies([tenant.adminCookie]);
 *     await page.goto(tenant.tenantUrl("/admin/children"));
 *     // ...
 *   });
 *
 * Why this shape (see docs/nightly-specs/2026-04-23-interaction-tests-critical-paths.md):
 *
 * - Each spec gets a unique `slug` (via `shortSlug()`) so parallel
 *   workers don't collide on `Org.slug UNIQUE` or on viewer-access
 *   rate-limiter state. If two workers picked the same slug the PIN
 *   lockout test would cascade.
 *
 * - The fixture talks to `file:./dev.db` directly through @libsql/client
 *   — the same path `scripts/seed.ts` uses. This avoids pulling the
 *   full Better Auth + Prisma + D1 runtime into the Playwright process.
 *   The tradeoff is schema coupling: if the Session / User / Org
 *   columns change, this file needs a matching edit. That's accepted
 *   as cheaper than driving `/signup` + `/login` for every test (2s+
 *   per spec and itself a failure surface we already cover in
 *   flows/signup-to-paid.spec.ts).
 *
 * - The `adminCookie` returned is the raw Better Auth session cookie
 *   (prefix `tome`, default cookie name `session_token`). Spec code
 *   calls `page.context().addCookies([tenant.adminCookie])` and is
 *   then a logged-in admin for that org's tenant host.
 *
 * - Teardown is best-effort DELETE and tolerates failure. Specs must
 *   not depend on cleanup for correctness — the unique slug per spec
 *   already guarantees isolation.
 */
import { test as base, expect, type Cookie } from "@playwright/test";
import { createClient, type Client as LibsqlClient } from "@libsql/client";
export type { Client as LibsqlClient } from "@libsql/client";
import {
  generateId,
  hashPassword,
  randomToken,
  shortSlug,
} from "./seed-helpers";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type SeededTenant = {
  /** Org row id (e.g. "abc123..."). */
  orgId: string;
  /** URL-safe per-spec slug, e.g. "e2e-1a2b3c". Used as tenant host. */
  slug: string;
  /** Admin user id. */
  userId: string;
  /** Admin user email, unique per spec. */
  adminEmail: string;
  /** Admin user password. Plaintext so a test can exercise /login if it wants. */
  adminPassword: string;
  /** Already-logged-in Better Auth session cookie. Add via page.context().addCookies([cookie]). */
  adminCookie: Cookie;
  /** Plaintext viewer PIN. The hash is written to AppSettings for this org. */
  viewerPin: string;
  /** Pre-seeded homeroom name. */
  homeroomName: string;
  /** Pre-seeded space number. */
  spaceNumber: number;

  /** Build a `http://{slug}.localhost:<port>{path}` URL. Defaults to the Playwright baseURL port. */
  tenantUrl: (path: string) => string;
  /** Build a `http://localhost:<port>{path}` URL for marketing-host traffic on the same port. */
  marketingUrl: (path: string) => string;

  /**
   * Direct libsql handle to the same dev.db the Worker is reading. Specs
   * use this to assert D1 state that isn't visible through the UI (for
   * example `Space.status` flipping after a `/update/:space` POST, or a
   * `CallEvent` row being written by `workers/bingo-board.ts`).
   *
   * Borrowed from the fixture — don't close it; the fixture's `finally`
   * block owns the lifecycle.
   */
  db: LibsqlClient;

  /**
   * Clear residual dismissal state for `spaceNumber`:
   *   - Flip `Space.status` back to 'EMPTY' (clears any prior `/update`).
   *   - Drop `CallEvent` rows for the spaceNumber, across *all* orgIds.
   *
   * The second sweep is deliberate: `workers/bingo-board.ts` inserts
   * `CallEvent` with the D1 column default (`org_tome`), not with the
   * requesting tenant's `orgId` — a cross-tenant bug that the dismissal
   * spec flags in its own summary. Cleaning by `spaceNumber` alone keeps
   * the next spec on the same wrangler-dev instance from seeing stale
   * rows when the fixture happens to pick a duplicate high-number space.
   *
   * Idempotent — safe to call in teardown even when nothing happened.
   */
  resetBoardForSpace: (spaceNumber: number) => Promise<void>;
};

type Fixtures = {
  tenant: SeededTenant;
};

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

// Cookie prefix comes from better-auth config in app/domain/auth/better-auth.server.ts.
const COOKIE_PREFIX = "tome";
const BETTER_AUTH_COOKIE_NAME = `${COOKIE_PREFIX}.session_token`;

// Sessions last 90 days in production. For an e2e fixture 1 day is plenty
// and avoids any clock-skew weirdness on CI runners.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Playwright baseURL is http://localhost:8787. The fixture respects
// process.env.PLAYWRIGHT_BASE_URL so the staging config works too, but
// the tenant-host flows only make sense against wrangler dev — staging
// is per AGENTS.md reserved for the smoke sweep.
const DEFAULT_BASE_URL = "http://localhost:8787";

function baseUrl(): URL {
  return new URL(process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL);
}

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./dev.db";
}

/* ------------------------------------------------------------------ */
/* Low-level seed + teardown                                          */
/* ------------------------------------------------------------------ */

type SeedOptions = {
  billingPlan?: "FREE" | "CAR_LINE" | "CAMPUS";
};

type SeededState = {
  org: { id: string; slug: string };
  user: { id: string; email: string; password: string };
  account: { id: string };
  session: { id: string; token: string; expiresAt: Date };
  appSettings: { viewerPin: string };
  teacher: { id: number; homeRoom: string };
  space: { id: number; spaceNumber: number };
};

async function insertSeedRows(
  db: LibsqlClient,
  opts: SeedOptions,
): Promise<SeededState> {
  const slug = shortSlug("e2e");
  const orgId = generateId();
  const userId = generateId();
  const accountId = generateId();
  const sessionId = generateId();

  const adminEmail = `admin-${slug}@e2e.pickuproster.test`;
  const adminPassword = `Pw-${randomToken(8)}`;
  const viewerPin = `${Math.floor(100000 + Math.random() * 900000)}`;
  const homeRoom = `Room-${slug}`;
  // Space numbers above 90000 keep seeded spaces out of any human-readable
  // range we'd use in screenshots or manual QA — makes it trivial to
  // eyeball "is this a leftover from a prior test run?"
  const spaceNumber = 90_000 + Math.floor(Math.random() * 9_000);

  const pwHash = await hashPassword(adminPassword);
  const pinHash = await hashPassword(viewerPin);
  const sessionToken = randomToken(32);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const expiresAtIso = expiresAt.toISOString();

  // Most writes here are INSERT-only. The single UPSERT is AppSettings:
  // the schema has an `id TEXT PRIMARY KEY` with a seeded 'default' row,
  // and `viewerPinHash` is a column not a per-id row — but we need one
  // AppSettings row per org thanks to the migration 0005z orgId column,
  // so we insert a fresh row keyed by a random id.
  const appSettingsId = generateId();

  await db.batch(
    [
      {
        sql: `INSERT INTO "Org" (id, name, slug, status, billingPlan, createdAt, updatedAt)
              VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        args: [orgId, `E2E Org ${slug}`, slug, opts.billingPlan ?? "CAR_LINE", nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "User" (id, email, name, role, emailVerified, mustChangePassword, orgId, createdAt, updatedAt)
              VALUES (?, ?, ?, 'ADMIN', 1, 0, ?, ?, ?)`,
        args: [userId, adminEmail, `E2E Admin ${slug}`, orgId, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
              VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
        args: [accountId, adminEmail, userId, pwHash, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "Session" (id, token, expiresAt, userId, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [sessionId, sessionToken, expiresAtIso, userId, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "AppSettings" (id, viewerDrawingEnabled, viewerPinHash, orgId)
              VALUES (?, 0, ?, ?)`,
        args: [appSettingsId, pinHash, orgId],
      },
      {
        sql: `INSERT INTO "Teacher" (homeRoom, orgId) VALUES (?, ?)`,
        args: [homeRoom, orgId],
      },
      {
        sql: `INSERT INTO "Space" (spaceNumber, status, orgId) VALUES (?, 'EMPTY', ?)`,
        args: [spaceNumber, orgId],
      },
    ],
    "write",
  );

  // Teacher + Space use AUTOINCREMENT ids, look them up.
  const teacherRow = await db.execute({
    sql: `SELECT id FROM "Teacher" WHERE homeRoom = ? AND orgId = ?`,
    args: [homeRoom, orgId],
  });
  const spaceRow = await db.execute({
    sql: `SELECT id FROM "Space" WHERE spaceNumber = ? AND orgId = ?`,
    args: [spaceNumber, orgId],
  });

  return {
    org: { id: orgId, slug },
    user: { id: userId, email: adminEmail, password: adminPassword },
    account: { id: accountId },
    session: { id: sessionId, token: sessionToken, expiresAt },
    appSettings: { viewerPin },
    teacher: { id: Number(teacherRow.rows[0]?.id ?? 0), homeRoom },
    space: { id: Number(spaceRow.rows[0]?.id ?? 0), spaceNumber },
  };
}

async function teardownSeedRows(db: LibsqlClient, state: SeededState): Promise<void> {
  // Best-effort teardown. Order matters for FK: children first.
  const stmts = [
    { sql: `DELETE FROM "CallEvent" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "Student" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "Space" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "Teacher" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "ViewerAccessAttempt" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "ViewerAccessSession" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "AppSettings" WHERE orgId = ?`, args: [state.org.id] },
    { sql: `DELETE FROM "Session" WHERE userId = ?`, args: [state.user.id] },
    { sql: `DELETE FROM "Account" WHERE userId = ?`, args: [state.user.id] },
    { sql: `DELETE FROM "User" WHERE id = ?`, args: [state.user.id] },
    { sql: `DELETE FROM "Org" WHERE id = ?`, args: [state.org.id] },
  ];
  for (const s of stmts) {
    try {
      await db.execute(s);
    } catch {
      // Tolerate — the unique per-spec slug means leftover rows are
      // harmless on the next run and the dev.db is disposable.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

export const test = base.extend<Fixtures>({
  tenant: async ({}, use, testInfo) => {
    const db = createClient({ url: databaseUrl() });
    // The tenant host lives on a subdomain of the Playwright baseURL.
    // Wrangler dev serves every Host header on its listening port, so
    // {slug}.localhost:PORT works without any /etc/hosts changes.
    const opts: SeedOptions = {
      billingPlan:
        (testInfo.project.metadata?.tenantBillingPlan as SeedOptions["billingPlan"]) ?? "CAR_LINE",
    };

    let state: SeededState | null = null;
    try {
      state = await insertSeedRows(db, opts);
    } catch (err) {
      db.close();
      throw new Error(
        `seeded-tenant fixture: failed to insert rows — is wrangler dev running and has the dev.db migrated? (${(err as Error).message})`,
      );
    }

    const url = baseUrl();
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const host = `${state.org.slug}.localhost`;
    const marketingHost = "localhost";

    const adminCookie: Cookie = {
      name: BETTER_AUTH_COOKIE_NAME,
      value: state.session.token,
      // Use the tenant host. Better Auth reads the cookie host-scoped in
      // dev — we're not setting Domain=.localhost because Playwright
      // treats localhost + subdomain as different hosts for cookie
      // scoping, which is exactly what we want (keeps per-spec state
      // isolated).
      domain: host,
      path: "/",
      expires: Math.floor(state.session.expiresAt.getTime() / 1000),
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    };

    const tenant: SeededTenant = {
      orgId: state.org.id,
      slug: state.org.slug,
      userId: state.user.id,
      adminEmail: state.user.email,
      adminPassword: state.user.password,
      adminCookie,
      viewerPin: state.appSettings.viewerPin,
      homeroomName: state.teacher.homeRoom,
      spaceNumber: state.space.spaceNumber,
      tenantUrl: (path: string) =>
        `${url.protocol}//${host}:${port}${path.startsWith("/") ? path : `/${path}`}`,
      marketingUrl: (path: string) =>
        `${url.protocol}//${marketingHost}:${port}${path.startsWith("/") ? path : `/${path}`}`,
      db,
      resetBoardForSpace: async (spaceNumber: number) => {
        try {
          await db.execute({
            sql: `UPDATE "Space" SET status='EMPTY', timestamp=NULL WHERE spaceNumber=?`,
            args: [spaceNumber],
          });
          await db.execute({
            sql: `DELETE FROM "CallEvent" WHERE spaceNumber=?`,
            args: [spaceNumber],
          });
        } catch {
          // Best-effort — see the doc-comment on the field.
        }
      },
    };

    try {
      await use(tenant);
    } finally {
      if (state) {
        // Drop dismissal side-effects first — Space.status reset + CallEvent
        // sweep by spaceNumber (the bingo-board DO writes events without
        // scoping by orgId, so teardownSeedRows' `WHERE orgId = ?` purge
        // alone leaves the row behind).
        try {
          await db.execute({
            sql: `UPDATE "Space" SET status='EMPTY', timestamp=NULL WHERE spaceNumber=?`,
            args: [state.space.spaceNumber],
          });
          await db.execute({
            sql: `DELETE FROM "CallEvent" WHERE spaceNumber=?`,
            args: [state.space.spaceNumber],
          });
        } catch {
          // Tolerate — teardownSeedRows runs next and the unique per-spec
          // spaceNumber keeps any leftover rows from colliding on the next
          // fixture pick.
        }
        await teardownSeedRows(db, state);
      }
      db.close();
    }
  },
});

export { expect };
