/**
 * Unit tests for pruneCallEventsWithDb (call-event-retention.server.ts).
 *
 * Verifies the daily-cron "D1 TTL" for pickup history:
 *   - each tenant's window is honored (default 90, per-tenant overrides),
 *   - the cutoff is computed as now - days,
 *   - orgs with no AppSettings row fall back to the default window.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HISTORY_RETENTION_DAYS,
  pruneCallEventsWithDb,
  type RetentionDb,
} from "./call-event-retention.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-19T10:00:00.000Z");

type DeleteCall = {
  orgFilter: { in: string[] } | { notIn: string[] };
  cutoff: Date;
};

function fakeDb(
  settings: Array<{ orgId: string; historyRetentionDays: number | null }>,
  counts: number[] = [],
): { db: RetentionDb; deletes: DeleteCall[] } {
  const deletes: DeleteCall[] = [];
  let i = 0;
  const db: RetentionDb = {
    appSettings: {
      findMany: async () => settings,
    },
    callEvent: {
      deleteMany: async ({ where }) => {
        deletes.push({ orgFilter: where.orgId, cutoff: where.createdAt.lt });
        return { count: counts[i++] ?? 0 };
      },
    },
  };
  return { db, deletes };
}

test("default window: one configured org at 90 days uses now-90d cutoff", async () => {
  const { db, deletes } = fakeDb([
    { orgId: "org_a", historyRetentionDays: 90 },
  ]);
  await pruneCallEventsWithDb(db, NOW);

  // group delete for org_a, then the notIn fallback sweep
  assert.equal(deletes.length, 2);
  const group = deletes[0];
  assert.deepEqual(group.orgFilter, { in: ["org_a"] });
  assert.equal(group.cutoff.getTime(), NOW.getTime() - 90 * DAY_MS);
});

test("per-tenant overrides produce one grouped delete each with distinct cutoffs", async () => {
  const { db, deletes } = fakeDb([
    { orgId: "org_short", historyRetentionDays: 30 },
    { orgId: "org_long", historyRetentionDays: 365 },
  ]);
  await pruneCallEventsWithDb(db, NOW);

  const byDays = new Map(
    deletes
      .filter((d) => "in" in d.orgFilter)
      .map((d) => [
        (d.orgFilter as { in: string[] }).in.join(","),
        d.cutoff.getTime(),
      ]),
  );
  assert.equal(byDays.get("org_short"), NOW.getTime() - 30 * DAY_MS);
  assert.equal(byDays.get("org_long"), NOW.getTime() - 365 * DAY_MS);
});

test("null retention falls back to the default window", async () => {
  const { db, deletes } = fakeDb([
    { orgId: "org_x", historyRetentionDays: null },
  ]);
  await pruneCallEventsWithDb(db, NOW);
  assert.equal(
    deletes[0].cutoff.getTime(),
    NOW.getTime() - DEFAULT_HISTORY_RETENTION_DAYS * DAY_MS,
  );
});

test("fallback sweep targets orgs with no AppSettings row (notIn configured ids)", async () => {
  const { db, deletes } = fakeDb([
    { orgId: "org_a", historyRetentionDays: 90 },
    { orgId: "org_b", historyRetentionDays: 90 },
  ]);
  await pruneCallEventsWithDb(db, NOW);

  const fallback = deletes.find((d) => "notIn" in d.orgFilter);
  assert.ok(fallback, "expected a notIn fallback delete");
  assert.deepEqual(fallback!.orgFilter, { notIn: ["org_a", "org_b"] });
  assert.equal(
    fallback!.cutoff.getTime(),
    NOW.getTime() - DEFAULT_HISTORY_RETENTION_DAYS * DAY_MS,
  );
});

test("returns the total rows deleted across all sweeps", async () => {
  const { db } = fakeDb(
    [{ orgId: "org_a", historyRetentionDays: 90 }],
    [7, 3], // group delete + fallback delete
  );
  const total = await pruneCallEventsWithDb(db, NOW);
  assert.equal(total, 10);
});
