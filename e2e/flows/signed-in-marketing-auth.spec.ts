/**
 * Signed-in visitors on the marketing host should not see the create-account
 * form. The session cookie is sent on the Cookie header the way a shared
 * apex cookie would be in production (local dev cannot use Domain=localhost).
 */
import { createClient } from "@libsql/client";
import { test, expect, databaseUrl } from "../fixtures/seeded-tenant";

test("signed-in marketing login and signup skip the account form", async ({
  page,
  tenant,
}) => {
  const db = createClient({ url: databaseUrl() });
  const cookie = `${tenant.adminCookie.name}=${tenant.adminCookie.value}`;
  const get = (path: string) =>
    page.request.get(path, {
      maxRedirects: 0,
      headers: { cookie },
    });

  try {
    const signup = await get("/signup?plan=car-line");
    expect(signup.status()).toBe(302);
    expect(signup.headers().location ?? "").toContain(
      `${tenant.slug}.pickuproster.com`,
    );

    const login = await get("/login");
    expect(login.status()).toBe(302);
    expect(login.headers().location ?? "").toContain(
      `${tenant.slug}.pickuproster.com`,
    );

    const evil = await get("/login?next=https://evil.example/phish");
    expect(evil.status()).toBe(302);
    expect(evil.headers().location ?? "").not.toContain("evil.example");

    const next = await get("/login?next=/admin/billing");
    expect(next.status()).toBe(302);
    expect(next.headers().location).toBe("/admin/billing");

    await db.execute({
      sql: `UPDATE "User" SET orgId = NULL, role = 'VIEWER' WHERE id = ?`,
      args: [tenant.userId],
    });

    const onboarding = await get("/signup?plan=car-line");
    expect(onboarding.status()).toBe(302);
    const onboardingLocation = onboarding.headers().location ?? "";
    expect(onboardingLocation).toContain("step=2");
    expect(onboardingLocation).toContain("plan=car-line");

    const schoolStep = await get("/signup?step=2&plan=car-line");
    expect(schoolStep.status()).toBe(200);
    expect(await schoolStep.text()).toContain("Your school");

    await db.execute({
      sql: `UPDATE "User" SET role = 'PLATFORM_ADMIN', orgId = NULL WHERE id = ?`,
      args: [tenant.userId],
    });
    const staffSignup = await get("/signup?plan=car-line");
    expect(staffSignup.status()).toBe(302);
    expect(staffSignup.headers().location).toBe("/platform");
    const staffLogin = await get("/login");
    expect(staffLogin.status()).toBe(302);
    expect(staffLogin.headers().location).toBe("/platform");
  } finally {
    db.close();
  }

  const signedOut = await page.request.get("/signup?plan=car-line", {
    maxRedirects: 0,
  });
  expect(signedOut.status()).toBe(200);
  expect(await signedOut.text()).toContain("Your name");
});
