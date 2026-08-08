/**
 * dismissal critical path — controller records/clears a space, D1 reflects it.
 *
 * Covers:
 *   1. A CONTROLLER POSTs `/update/:space` on the tenant host; `Space.status`
 *      flips to 'ACTIVE' in D1 and a matching `CallEvent` row is written.
 *   2. CONTROLLER POSTs `/empty/:space`; `Space.status` returns to 'EMPTY'
 *      WITHOUT writing a second CallEvent.
 *   3. The same loop runs a second time on the same space without a clean
 *      restart — proves the second `/update` isn't a no-op (no stuck state).
 *
 * Auth note (changed on current master): `/update/:space` and
 * `/empty/:space` are gated to role CONTROLLER — ADMINs are intentionally
 * excluded ("managing the roster ≠ running it", see app/routes/update.$space.tsx).
 * So this spec authenticates with `tenant.controllerCookie`, NOT
 * `tenant.adminCookie`. The fixture seeds a dedicated CONTROLLER user.
 *
 * Why we assert against D1 directly and not through a second browser
 * context on `/`:
 *   - The public board at `/` reads from D1 for the initial paint plus a
 *     WebSocket subscription for realtime updates. Pulling websocket wiring
 *     in here would make the spec flaky on slow CI runners and test the
 *     realtime surface rather than the dismissal-write path we care about.
 *   - libsql over the wrangler-dev sqlite file is the same store the worker
 *     writes to (see e2e/fixtures/seeded-tenant.ts for the rationale). A
 *     targeted `SELECT status FROM "Space"` is the authoritative check.
 *
 * The dismissal writes now run through tenant-scoped Prisma in the route
 * actions (the BINGO_BOARD DO is no longer on the write path), so CallEvent
 * rows are correctly scoped to the tenant's orgId. We still filter the
 * CallEvent count by spaceNumber — the seeded spaceNumber is unique per
 * spec (90000+ random), so it's an unambiguous key.
 *
 * Fixture surface used:
 *   - `tenant.controllerCookie`      — logged-in CONTROLLER session
 *   - `tenant.spaceNumber`           — unique per-spec seeded space
 *   - `tenant.tenantUrl(path)`       — `http://<slug>.localhost:8787<path>`
 *   - `tenant.db`                    — libsql client pointed at the dev sqlite
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

  test("controller /update/:space flips to ACTIVE and writes a CallEvent", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.controllerCookie]);

    // Precondition: the fixture seeds Space.status = 'EMPTY' for the
    // unique spaceNumber. If we got something else, a prior run on the
    // same wrangler dev leaked state and resetBoardForSpace teardown is
    // not doing its job.
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");
    const callEventsBefore = await readCallEventCount(tenant.db, tenant.spaceNumber);

    // POST /update/:space from the logged-in controller. The action
    // returns plain "OK" (no redirect) so we just await the response.
    const updateResp = await page.request.post(
      tenant.tenantUrl(`/update/${tenant.spaceNumber}`),
    );
    expect(updateResp.ok()).toBe(true);

    // The action writes Space.status = 'ACTIVE' synchronously inside its
    // await chain (see app/routes/update.$space.tsx). No polling needed.
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");

    // One new CallEvent per dismissal call.
    const callEventsAfter = await readCallEventCount(tenant.db, tenant.spaceNumber);
    expect(callEventsAfter).toBe(callEventsBefore + 1);
  });

  test("/empty/:space returns Space.status to EMPTY and does not emit a CallEvent", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.controllerCookie]);

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

    // /empty/:space is the "undo" of /update — it clears the status
    // without generating a second CallEvent (see app/routes/empty.$space.tsx:
    // it only updates Space + broadcasts, no CallEvent insert).
    const callEventsAfterEmpty = await readCallEventCount(tenant.db, tenant.spaceNumber);
    expect(callEventsAfterEmpty).toBe(callEventsAfterUpdate);
  });

  test("the same space can be called twice — no stuck ACTIVE state", async ({
    page,
    tenant,
  }) => {
    await page.context().addCookies([tenant.controllerCookie]);

    // First call cycle.
    await page.request.post(tenant.tenantUrl(`/update/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");
    await page.request.post(tenant.tenantUrl(`/empty/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");

    // Second call cycle, same space. If the action were short-circuiting
    // on "already active recently" or storing per-space state in memory,
    // the second /update would be a no-op.
    await page.request.post(tenant.tenantUrl(`/update/${tenant.spaceNumber}`));
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("ACTIVE");

    // Two distinct call cycles ⇒ at least two CallEvents.
    expect(
      await readCallEventCount(tenant.db, tenant.spaceNumber),
    ).toBeGreaterThanOrEqual(2);
  });

  test("an ADMIN is forbidden from recording a dismissal", async ({
    page,
    tenant,
  }) => {
    // Regression gate for the CONTROLLER-only authorization on the
    // dismissal endpoints. An ADMIN session must be rejected (403) and
    // must NOT flip the space.
    await page.context().addCookies([tenant.adminCookie]);

    const resp = await page.request.post(
      tenant.tenantUrl(`/update/${tenant.spaceNumber}`),
    );
    expect(resp.status()).toBe(403);
    expect(await readSpaceStatus(tenant.db, tenant.spaceNumber)).toBe("EMPTY");
  });
});
