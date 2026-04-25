/**
 * dismissal critical path — controller/viewer/history loop.
 *
 * Covers:
 *   1. Admin POSTs `/update/:space` on the tenant host; `Space.status`
 *      flips to 'ACTIVE' in D1 and a matching `CallEvent` row is written.
 *   2. Admin POSTs `/empty/:space`; `Space.status` returns to 'EMPTY'.
 *   3. The same loop runs a second time on the same space without a
 *      clean restart — proves the BINGO_BOARD Durable Object doesn't
 *      leave the space in a state where the second `/update` is a no-op.
 *
 * Why we assert against D1 directly and not through a second browser
 * context on `/`:
 *
 *   - The public board at `/` is a read-from-D1 render for the initial
 *     paint plus a WebSocket subscription to BINGO_BOARD for realtime
 *     updates. Pulling in websocket wiring here would make the spec
 *     flaky on slow CI runners and test the realtime surface rather
 *     than the dismissal-write path we actually care about.
 *   - libsql over `file:./dev.db` is the same file wrangler dev writes
 *     to (see `e2e/fixtures/seeded-tenant.ts` for the rationale). A
 *     targeted `SELECT status FROM "Space" WHERE spaceNumber = ?` is
 *     the authoritative check.
 *
 * Why we do NOT drive `/admin/history` through the UI:
 *
 *   - Reports are plan-gated to CAMPUS+ (see `planAllowsReports` in
 *     `app/lib/plan-limits.ts`). The fixture defaults to CAR_LINE, and
 *     writing two different billing-plan projects just to render the
 *     history table would duplicate work that 0d.3 (branding-gate) is
 *     already queued to do.
 *   - `workers/bingo-board.ts` writes `CallEvent` rows via raw D1 SQL
 *     WITHOUT an explicit `orgId`, so rows land under the column
 *     default ("org_tome") instead of the requesting tenant's orgId.
 *     That means `/admin/history` for an e2e-seeded tenant would never
 *     show the event anyway. Flagged in docs/nightly/2026-04-24-0d1-dismissal-build.md
 *     under "bugs found during testing"; do NOT paper over by seeding
 *     a matching org — per the nightly-queue quality rule.
 *
 * Fixture surface used:
 *   - `tenant.adminCookie`           — logged-in admin session
 *   - `tenant.spaceNumber`           — unique per-spec seeded space
 *   - `tenant.tenantUrl(path)`       — `http://<slug>.localhost:8787<path>`
 *   - `tenant.db`                    — libsql client pointed at dev.db
 *   - `tenant.resetBoardForSpace(n)` — explicit cross-spec cleanup
 */
import { test, expect, type LibsqlClient } from "../fixtures/seeded-tenant";

async function readSpaceStatus(
  db: LibsqlClient,
  spaceNumber: number,
): Promise<string | null> {
  const row = await db.execute({
    sql: `SELECT status FROM "Space" WHERE spaceNumber = ? LIMIT 1`,
    args: [spaceNumber],
  });
  const status = row.rows[0]?.status;
  return typeof status === "string" ? status : null;
}

async function readCallEventCount(
  db: LibsqlClient,
  spaceNumber: number,
): Promise<number> {
  const row = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM "CallEvent" WHERE spaceNumber = ?`,
    args: [spaceNumber],
  });
  const n = row.rows[0]?.n;
  return typeof n === "number" ? n : Number(n ?? 0);
}

test.describe("@flow dismissal — /update + /empty flip Space.status in D1", () => {
  test.afterEach(async ({ tenant }) => {
    // Explicit per-spec cleanup documented in fixtures/seeded-tenant.ts.
    // The fixture's own teardown will run next and re-sweep; idempotent.
    await tenant.resetBoardForSpace(tenant.spaceNumber);
  });

  test("admin /update/:space flips to ACTIVE and writes a CallEvent", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);

    // Precondition: the fixture seeds Space.status = 'EMPTY' for the
    // unique spaceNumber. If we got something else, a prior run on the
    // same wrangler dev leaked state and the `resetBoardForSpace`
    // teardown is not doing its job.
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");
    const callEventsBefore = await readCallEventCount(tenant.db, tenant.spaceNumber);

    // POST /update/:space from the logged-in admin. The action returns
    // plain "OK" (no redirect) so we just await the response.
    const updateResp = await page.request.post(
      tenant.tenantUrl(`/update/${tenant.spaceNumber}`),
    );
    expect(updateResp.ok()).toBe(true);

    // The BINGO_BOARD DO writes Space.status = 'ACTIVE' synchronously
    // inside the action's await chain (see workers/bingo-board.ts).
    // No polling loop needed.
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");

    // One new CallEvent per dismissal call. Filter by spaceNumber only —
    // the DO writes these rows under the D1 column default for orgId
    // ("org_tome"), not the tenant's orgId. See flagged bug in the
    // build summary.
    const callEventsAfter = await readCallEventCount(tenant.db, tenant.spaceNumber);
    expect(callEventsAfter).toBe(callEventsBefore + 1);
  });

  test("/empty/:space returns Space.status to EMPTY and does not emit a CallEvent", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);

    // Set the space ACTIVE first (via the same /update path the previous
    // test exercises) so the /empty transition has something to revert.
    const updateResp = await page.request.post(
      tenant.tenantUrl(`/update/${tenant.spaceNumber}`),
    );
    expect(updateResp.ok()).toBe(true);
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");
    const callEventsAfterUpdate = await readCallEventCount(tenant.db, tenant.spaceNumber);

    const emptyResp = await page.request.post(
      tenant.tenantUrl(`/empty/${tenant.spaceNumber}`),
    );
    expect(emptyResp.ok()).toBe(true);

    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");

    // /empty/:space is supposed to be the "undo" of /update — it clears
    // the status without generating a second CallEvent (see the else
    // branch in workers/bingo-board.ts: it only broadcasts, no INSERT).
    const callEventsAfterEmpty = await readCallEventCount(tenant.db, tenant.spaceNumber);
    expect(callEventsAfterEmpty).toBe(callEventsAfterUpdate);
  });

  test("the same space can be called twice — no stuck ACTIVE state", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.adminCookie]);

    // First call cycle.
    await page.request.post(tenant.tenantUrl(`/update/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");
    await page.request.post(tenant.tenantUrl(`/empty/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");

    // Second call cycle, same space. If the DO were accidentally
    // short-circuiting on "already active recently" or storing
    // per-space state in memory, the second /update would be a no-op.
    await page.request.post(tenant.tenantUrl(`/update/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");

    // Two distinct call cycles ⇒ two CallEvents.
    expect(await readCallEventCount(tenant.db, tenant.spaceNumber)).toBeGreaterThanOrEqual(2);
  });

  // Bugs found during testing (quality-rule: do not paper over; flag here):
  //
  //   • bingo-board DO writes CallEvent without orgId
  //     `workers/bingo-board.ts` uses raw D1 SQL
  //         INSERT INTO "CallEvent" (spaceNumber, studentId, studentName,
  //                                   homeRoomSnapshot, createdAt) VALUES (...)
  //     Prisma tenant extension doesn't apply (raw SQL path); the row
  //     lands under the column default `org_tome` instead of the
  //     requesting tenant's orgId. Consequence: `/admin/history` for
  //     any non-`org_tome` tenant never shows its own dismissal events.
  //     The spec below is left `.fixme` until the DO is fixed to either
  //     accept `orgId` in the POST body or look it up from the Space row.
  //
  //   • bingo-board DO UPDATE/SELECT also unscoped by orgId
  //     `UPDATE "Space" SET status='ACTIVE' WHERE spaceNumber=?` and the
  //     pre-INSERT `SELECT ... FROM "Student" WHERE spaceNumber=?` both
  //     elide orgId. If two tenants ever pick the same spaceNumber (they
  //     share a unique index on spaceNumber globally today so this
  //     is prevented at the schema level — but the schema is wrong
  //     for multi-tenant and a separate migration will relax it).
  //     Tracked for the same follow-up as the CallEvent issue.
  test.fixme(
    "admin sees the dismissal event on /admin/history",
    async ({ page, tenant }) => {
      // Left unimplemented intentionally. Two blockers:
      //   1. The DO's CallEvent INSERT drops orgId — row lands under
      //      `org_tome`, so the tenant's history page never sees it.
      //   2. /admin/history is CAMPUS+-gated; the fixture defaults to
      //      CAR_LINE. Unblocking this test needs (a) the DO fix above
      //      and (b) either a billingPlan override on the fixture or a
      //      Playwright project-metadata toggle (0d.3's scope).
      await page.context().addCookies([tenant.adminCookie]);
      await page.request.post(tenant.tenantUrl(`/update/${tenant.spaceNumber}`));
      await page.goto(tenant.tenantUrl("/admin/history"));
      await expect(page.getByText(`Space ${tenant.spaceNumber}`)).toBeVisible();
    },
  );
});
