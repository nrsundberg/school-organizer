/**
 * admin-roster critical path.
 *
 * Covers: create student via `/create/student`, verify the student shows
 * up on `/admin/children` under the expected homeroom. The fixture
 * pre-seeds one homeroom so the test stays focused on the create-student
 * action rather than the homeroom create flow (that is its own short
 * path at the end). Space numbers now live on Household, not Student, so
 * this flow no longer exercises the space field — that's covered by
 * household-edit specs.
 *
 * Auth: uses the `tenant` fixture, which inserts a Better Auth Session
 * row directly and hands the spec a pre-baked `adminCookie`. We add
 * the cookie to the browser context before the first navigation.
 *
 * Host: tenant-authed routes (`/admin/*`, `/create/*`) live on the
 * tenant subdomain. We navigate via `tenant.tenantUrl(...)` so the
 * request hits `<slug>.localhost:8787` and the host-detection in
 * `app/domain/utils/host.server.ts` treats us as a tenant request.
 *
 * Quality rule: if any assertion fails because of a real app bug (e.g.
 * the plan-usage guard rejecting the create for a fresh org), do NOT
 * adjust the test to match the buggy behavior. Leave it as a hard
 * failure OR gate with `test.fixme(..., "<bug description>")` and
 * raise it in the nightly build summary.
 */
import { test, expect } from "../fixtures/seeded-tenant";

test.describe("@flow admin-roster — create student + see it on /admin/children", () => {
  test("admin seeds student and roster reflects homeroom", async ({ page, tenant }) => {
    await page.context().addCookies([tenant.adminCookie]);

    const firstName = `E2E${Date.now()}`;
    const lastName = "Student";

    // Navigate to the create form first so the loader runs and the
    // homeroom datalist is populated with the seeded homeroom name.
    await page.goto(tenant.tenantUrl("/create/student"));
    await expect(page.getByRole("heading", { name: /Create New Student/i })).toBeVisible();

    // Fill the form. `homeRoom` is a native input with a datalist — free
    // text is fine as long as it matches a seeded Teacher.homeRoom row,
    // which the action asserts via `prisma.teacher.findUnique`.
    await page.getByLabel("First Name").fill(firstName);
    await page.getByLabel("Last Name").fill(lastName);
    await page.getByLabel("Homeroom").fill(tenant.homeroomName);

    // The submit button text flips to "Creating..." while pending, then
    // the action redirects to /admin on success.
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/admin" || u.pathname === "/admin/dashboard"),
      page.getByRole("button", { name: /Create Student/i }).click(),
    ]);

    // Verify the student appears under the expected homeroom on /admin/children.
    await page.goto(tenant.tenantUrl("/admin/children"));
    await expect(page.getByRole("heading", { name: /Children|Classes/i }).first()).toBeVisible();

    // Click the homeroom row to expand it, then assert the student row.
    const homeroomRow = page.getByRole("button", { name: new RegExp(tenant.homeroomName) });
    await expect(homeroomRow).toBeVisible();
    await homeroomRow.click();

    // The expanded card renders "<lastName>, <firstName>" as the student
    // link. Scope to the homeroom card so an unrelated row from a dirty
    // dev.db can't satisfy this assertion.
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: tenant.homeroomName, exact: true }),
    });
    await expect(card.getByRole("link", { name: `${lastName}, ${firstName}` })).toBeVisible();
  });

  test("create-student rejects unknown homeroom name", async ({ page, tenant }) => {
    await page.context().addCookies([tenant.adminCookie]);
    await page.goto(tenant.tenantUrl("/create/student"));

    await page.getByLabel("First Name").fill("Ghost");
    await page.getByLabel("Last Name").fill("Student");
    await page.getByLabel("Homeroom").fill(`NotASeededHomeroom-${Date.now()}`);

    await page.getByRole("button", { name: /Create Student/i }).click();

    // The action returns `{ error: "Please choose an existing homeroom from suggestions" }`
    // without navigating away from /create/student.
    await expect(
      page.getByText(/Please choose an existing homeroom/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/create\/student/);
  });
});
