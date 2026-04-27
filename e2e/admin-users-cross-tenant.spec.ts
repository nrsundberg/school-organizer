/**
 * Regression for the multi-tenant data leak on /admin/users.
 *
 * Until the fix, `prisma.user.findMany()` ran with no `where` clause —
 * so `bhs-example.pickuproster.com/admin/users` listed every User in the
 * system, across every tenant. The companion mutation actions
 * (resetPassword, changeRole, revokeUserSessions, deleteUser, ban,
 * unban, impersonateUser) operated on the supplied userId without
 * verifying it belonged to the current org, so a tenant admin could
 * mutate users in any other tenant by guessing ids.
 *
 * This spec seeds a SECOND tenant alongside the fixture's primary one
 * and proves both halves of the fix:
 *   1. The /admin/users listing on tenant A omits tenant B's users.
 *   2. POSTing each mutation to tenant A's action with B's userId
 *      neither succeeds nor mutates B's records.
 */
import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { test, expect, databaseUrl } from "./fixtures/seeded-tenant";
import {
  generateId,
  hashPassword,
  randomToken,
  shortSlug,
} from "./fixtures/seed-helpers";

type SecondTenant = {
  orgId: string;
  slug: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  accountId: string;
  accountPasswordHash: string;
  sessionId: string;
};

async function seedSecondTenant(db: LibsqlClient): Promise<SecondTenant> {
  const slug = shortSlug("e2e-other");
  const orgId = generateId();
  const userId = generateId();
  const accountId = generateId();
  const sessionId = generateId();
  const userEmail = `cross-${slug}@e2e.pickuproster.test`;
  const userName = `Cross-Tenant User ${slug}`;
  const userRole = "CONTROLLER";
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const accountPasswordHash = await hashPassword(`Pw-${randomToken(8)}`);
  const sessionToken = randomToken(32);

  await db.batch(
    [
      {
        sql: `INSERT INTO "Org" (id, name, slug, status, billingPlan, createdAt, updatedAt)
              VALUES (?, ?, ?, 'ACTIVE', 'CAR_LINE', ?, ?)`,
        args: [orgId, `Other Org ${slug}`, slug, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "User" (id, email, name, role, emailVerified, mustChangePassword, orgId, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)`,
        args: [userId, userEmail, userName, userRole, orgId, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
              VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
        args: [accountId, userEmail, userId, accountPasswordHash, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO "Session" (id, token, expiresAt, userId, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [sessionId, sessionToken, expiresAtIso, userId, nowIso, nowIso],
      },
    ],
    "write",
  );

  return {
    orgId,
    slug,
    userId,
    userEmail,
    userName,
    userRole,
    accountId,
    accountPasswordHash,
    sessionId,
  };
}

async function teardownSecondTenant(
  db: LibsqlClient,
  tenant: SecondTenant,
): Promise<void> {
  for (const stmt of [
    { sql: `DELETE FROM "Session" WHERE userId = ?`, args: [tenant.userId] },
    { sql: `DELETE FROM "Account" WHERE userId = ?`, args: [tenant.userId] },
    { sql: `DELETE FROM "User" WHERE id = ?`, args: [tenant.userId] },
    { sql: `DELETE FROM "Org" WHERE id = ?`, args: [tenant.orgId] },
  ]) {
    try {
      await db.execute(stmt);
    } catch {
      // tolerate — unique slug per spec keeps leftover rows harmless
    }
  }
}

test.describe("/admin/users tenant isolation", () => {
  test("listing on tenant A does not leak users from tenant B", async ({
    page,
    tenant,
  }) => {
    const db = createClient({ url: databaseUrl() });
    const other = await seedSecondTenant(db);
    try {
      await page.context().addCookies([tenant.adminCookie]);
      await page.goto(tenant.tenantUrl("/admin/users"));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // Tenant A's admin appears in the listing.
      await expect(
        page.locator("td", { hasText: tenant.adminEmail }),
      ).toBeVisible();
      // Tenant B's user must NOT appear.
      await expect(
        page.locator("td", { hasText: other.userEmail }),
      ).toHaveCount(0);
      await expect(
        page.locator("td", { hasText: other.userName }),
      ).toHaveCount(0);
    } finally {
      await teardownSecondTenant(db, other);
      db.close();
    }
  });

  test("mutations on tenant A refuse a userId from tenant B and leave B unchanged", async ({
    page,
    tenant,
  }) => {
    const db = createClient({ url: databaseUrl() });
    const other = await seedSecondTenant(db);
    try {
      await page.context().addCookies([tenant.adminCookie]);

      const mutations: Array<Record<string, string>> = [
        { action: "resetPassword" },
        { action: "changeRole", role: "VIEWER" },
        { action: "revokeUserSessions" },
        { action: "deleteUser" },
        { action: "ban", banReason: "test" },
        { action: "unban" },
        { action: "impersonateUser" },
      ];

      for (const fields of mutations) {
        const response = await page.request.post(
          tenant.tenantUrl("/admin/users"),
          {
            form: { ...fields, userId: other.userId },
            // Don't follow redirects so a (broken) successful impersonate
            // would surface as 303 instead of being silently followed.
            maxRedirects: 0,
            failOnStatusCode: false,
          },
        );
        // Cross-tenant attempts must not redirect (303 = impersonate
        // success). 200 (toast) and 404 are both acceptable refusal
        // shapes — what matters is that B's row is untouched, asserted
        // below.
        expect(
          response.status(),
          `${fields.action} unexpectedly returned ${response.status()} for a cross-tenant userId`,
        ).not.toBe(303);
      }

      // B's user row is exactly as seeded.
      const userRow = await db.execute({
        sql: `SELECT email, name, role, banned FROM "User" WHERE id = ?`,
        args: [other.userId],
      });
      expect(userRow.rows.length).toBe(1);
      expect(userRow.rows[0]?.email).toBe(other.userEmail);
      expect(userRow.rows[0]?.name).toBe(other.userName);
      expect(userRow.rows[0]?.role).toBe(other.userRole);
      expect(Number(userRow.rows[0]?.banned ?? 0)).toBe(0);

      // B's password hash unchanged (resetPassword would have rewritten it).
      const accountRow = await db.execute({
        sql: `SELECT password FROM "Account" WHERE id = ?`,
        args: [other.accountId],
      });
      expect(accountRow.rows[0]?.password).toBe(other.accountPasswordHash);

      // B's session still exists (revokeUserSessions would have deleted it).
      const sessionRow = await db.execute({
        sql: `SELECT id FROM "Session" WHERE id = ?`,
        args: [other.sessionId],
      });
      expect(sessionRow.rows.length).toBe(1);
    } finally {
      await teardownSecondTenant(db, other);
      db.close();
    }
  });
});
