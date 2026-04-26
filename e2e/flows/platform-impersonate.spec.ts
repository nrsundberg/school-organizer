/**
 * Platform-admin impersonation regression test.
 *
 * Reproduces the original bug: better-auth's admin plugin refuses to
 * impersonate any target whose role is in `adminRoles`, because the stock
 * `adminAc` doesn't grant `user:impersonate-admins` and we hadn't set
 * `allowImpersonatingAdmins: true`. The action at
 * `app/routes/platform/orgs.$orgId.tsx` caught the FORBIDDEN throw and
 * returned HTTP 400 silently. The test asserts the action now returns
 * HTTP 302 instead — i.e. better-auth allowed the impersonation and
 * issued a redirect to the tenant subdomain.
 *
 * We deliberately do NOT exercise the full cross-subdomain redirect
 * here: in local dev, `PUBLIC_ROOT_DOMAIN=pickuproster.com` causes
 * better-auth to set Set-Cookie with Domain=pickuproster.com, which the
 * browser drops on localhost requests. That part of the flow only works
 * against a real tenant host. Asserting status==302 is a sufficient
 * regression guard for the YOU_CANNOT_IMPERSONATE_ADMINS bug.
 */
import { createClient } from "@libsql/client";
import { test, expect } from "../fixtures/seeded-tenant";
import { generateId, hashPassword, randomToken } from "../fixtures/seed-helpers";

const COOKIE_PREFIX = "pickuproster";
const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Mirror seeded-tenant fixture's lookup. Wrangler 4 stores the local D1 sqlite
  // at .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite — we
  // cannot statically reference the hash so the fixture finds it dynamically.
  // For this spec we accept DATABASE_URL or the dev.db fallback.
  return "file:./dev.db";
}

test.describe("@flow platform-impersonate — admin can impersonate org admin", () => {
  test("action returns 302 when platform admin impersonates ADMIN target", async ({
    request,
    tenant,
  }) => {
    const db = createClient({ url: databaseUrl() });
    const platformAdminId = generateId();
    const accountId = generateId();
    const sessionId = generateId();
    const platformEmail = `platform-${Date.now()}@e2e.pickuproster.test`;
    const platformPassword = `Pw-${randomToken(8)}`;
    const sessionToken = randomToken(32);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const pwHash = await hashPassword(platformPassword);

    try {
      await db.batch(
        [
          {
            sql: `INSERT INTO "User" (id, email, name, role, emailVerified, mustChangePassword, createdAt, updatedAt)
                  VALUES (?, ?, ?, 'PLATFORM_ADMIN', 1, 0, ?, ?)`,
            args: [platformAdminId, platformEmail, "E2E Platform Admin", nowIso, nowIso],
          },
          {
            sql: `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
                  VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
            args: [accountId, platformEmail, platformAdminId, pwHash, nowIso, nowIso],
          },
          {
            sql: `INSERT INTO "Session" (id, token, expiresAt, userId, createdAt, updatedAt)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [sessionId, sessionToken, expiresAtIso, platformAdminId, nowIso, nowIso],
          },
        ],
        "write",
      );

      // POST the impersonate action as the platform admin. Use marketingUrl
      // (apex localhost) so the request hits the same host the platform
      // panel lives on. Send the session cookie via the Cookie header
      // because Playwright's request context isn't bound to any subdomain.
      const url = tenant.marketingUrl(`/platform/orgs/${tenant.orgId}`);
      const response = await request.post(url, {
        headers: {
          cookie: `${SESSION_COOKIE}=${sessionToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: new URLSearchParams({
          intent: "impersonate",
          userId: tenant.userId,
        }).toString(),
        maxRedirects: 0,
      });

      // Before the fix: better-auth threw YOU_CANNOT_IMPERSONATE_ADMINS,
      // the action's catch block returned 400. After the fix: better-auth
      // succeeds and the action returns 302 with Set-Cookie.
      expect(response.status(), `body: ${await response.text()}`).toBe(302);
      const location = response.headers()["location"];
      expect(location).toMatch(/\/admin$/);
      // Better-auth issues a fresh session_token Set-Cookie for the
      // impersonation session — confirm the action forwarded it.
      const setCookies = response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
      expect(setCookies.length).toBeGreaterThan(0);
      expect(setCookies.some((c) => c.value.includes(SESSION_COOKIE))).toBe(true);
    } finally {
      await db.execute({ sql: `DELETE FROM "Session" WHERE userId = ?`, args: [platformAdminId] }).catch(() => {});
      await db.execute({ sql: `DELETE FROM "Account" WHERE userId = ?`, args: [platformAdminId] }).catch(() => {});
      await db.execute({ sql: `DELETE FROM "User" WHERE id = ?`, args: [platformAdminId] }).catch(() => {});
      db.close();
    }
  });
});
