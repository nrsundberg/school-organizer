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
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@libsql/client";
import { test, expect } from "../fixtures/seeded-tenant";
import {
  generateId,
  hashPassword,
  randomToken,
  readBetterAuthSecret,
  sessionCookieName,
  signCookieValue,
} from "../fixtures/seed-helpers";

const COOKIE_PREFIX = "pickuproster";
// In CI (and any env where wrangler dev inherits `ENVIRONMENT=production`
// from `wrangler.jsonc`'s `vars`), better-auth runs with
// `useSecureCookies: true` and looks for the `__Secure-`-prefixed name.
// The cookie value also has to be HMAC-signed with `BETTER_AUTH_SECRET`
// or `getSignedCookie` returns null and the global middleware redirects
// every authenticated route to `/login`.
const SESSION_COOKIE = sessionCookieName({ cookiePrefix: COOKIE_PREFIX });

/**
 * Mirror the seeded-tenant fixture's D1 lookup. The spec inserts the
 * platform-admin session row directly, and wrangler dev reads from the
 * miniflare D1 sqlite under
 * `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` —
 * NOT from `./dev.db`. A simpler `file:./dev.db` fallback would write
 * to a different DB than wrangler reads, the session row would be
 * invisible to the worker, `requirePlatformAdmin` would redirect to
 * /login, and the test would fail with `location=/login?next=...`
 * instead of the expected `/admin`.
 */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const wranglerD1Dir = path.resolve(
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
  );
  if (fs.existsSync(wranglerD1Dir)) {
    const candidates = fs
      .readdirSync(wranglerD1Dir)
      .filter((f) => f.endsWith(".sqlite") && !f.startsWith("metadata"));
    if (candidates.length === 1) {
      return `file:${path.join(wranglerD1Dir, candidates[0])}`;
    }
    if (candidates.length > 1) {
      throw new Error(
        `platform-impersonate spec: multiple wrangler local D1 sqlites in ${wranglerD1Dir} (${candidates.join(
          ", ",
        )}). Set DATABASE_URL to disambiguate.`,
      );
    }
  }
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
      //
      // The cookie value has to be `URL_ENCODED(<token>.<base64-hmac>)`
      // because better-auth verifies the signature before doing the DB
      // lookup. Sending just `<token>` looks like a forged cookie and
      // gets dropped, after which `requirePlatformAdmin` throws a
      // redirect to `/login?next=/platform/orgs/...` — not the 302 to
      // `/admin` this test is asserting.
      const betterAuthSecret = readBetterAuthSecret();
      const signedCookieValue = await signCookieValue(sessionToken, betterAuthSecret);
      const url = tenant.marketingUrl(`/platform/orgs/${tenant.orgId}`);
      const response = await request.post(url, {
        headers: {
          cookie: `${SESSION_COOKIE}=${signedCookieValue}`,
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
