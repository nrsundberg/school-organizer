/**
 * Pickup-history (CallEvent) retention.
 *
 * D1 has no native row TTL, so we emulate one with a scheduled DELETE run from
 * the daily cron (workers/app.ts). Each tenant keeps
 * `AppSettings.historyRetentionDays` days of history (default
 * DEFAULT_HISTORY_RETENTION_DAYS); anything older is pruned. The per-tenant
 * column exists so retention can become a paid add-on later — bump a tenant's
 * value to extend their window without code changes.
 *
 * This is the long-tail bound that complements #74: the board reset no longer
 * deletes CallEvent (so history survives daily resets), and this prune keeps
 * the table from growing without limit.
 */
import { getPrisma } from "~/db.server";

export const DEFAULT_HISTORY_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal slice of the Prisma client this prune touches — keeps it testable. */
export type RetentionDb = {
  appSettings: {
    findMany: (args: {
      select: { orgId: true; historyRetentionDays: true };
    }) => Promise<Array<{ orgId: string; historyRetentionDays: number | null }>>;
  };
  callEvent: {
    deleteMany: (args: {
      where: {
        orgId: { in: string[] } | { notIn: string[] };
        createdAt: { lt: Date };
      };
    }) => Promise<{ count: number }>;
  };
};

/**
 * Delete CallEvent rows older than each tenant's retention window.
 *
 * Orgs are grouped by their effective window, so the whole sweep is a small
 * fixed number of deleteMany calls (one per distinct window, plus one for orgs
 * that have no AppSettings row yet and therefore fall back to the default).
 *
 * Returns the total number of rows deleted.
 */
export async function pruneCallEventsWithDb(
  db: RetentionDb,
  now: Date = new Date(),
): Promise<number> {
  const settings = await db.appSettings.findMany({
    select: { orgId: true, historyRetentionDays: true },
  });

  const orgIdsByDays = new Map<number, string[]>();
  const configuredOrgIds: string[] = [];
  for (const s of settings) {
    const days = s.historyRetentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
    configuredOrgIds.push(s.orgId);
    const list = orgIdsByDays.get(days) ?? [];
    list.push(s.orgId);
    orgIdsByDays.set(days, list);
  }

  const cutoffFor = (days: number) => new Date(now.getTime() - days * DAY_MS);

  let deleted = 0;
  for (const [days, orgIds] of orgIdsByDays) {
    const res = await db.callEvent.deleteMany({
      where: { orgId: { in: orgIds }, createdAt: { lt: cutoffFor(days) } },
    });
    deleted += res.count;
  }

  // Orgs that have never written an AppSettings row still get the default
  // window. `notIn: []` matches every org, which is exactly right when no
  // tenant is configured yet.
  const fallback = await db.callEvent.deleteMany({
    where: {
      orgId: { notIn: configuredOrgIds },
      createdAt: { lt: cutoffFor(DEFAULT_HISTORY_RETENTION_DAYS) },
    },
  });
  deleted += fallback.count;

  return deleted;
}

/**
 * Cron entrypoint: prune old CallEvent rows using the global (cross-tenant)
 * Prisma client. Mirrors pruneExpiredPasswordResetTokens.
 */
export async function pruneOldCallEvents(
  context: any,
  now: Date = new Date(),
): Promise<number> {
  return pruneCallEventsWithDb(getPrisma(context) as unknown as RetentionDb, now);
}
