/**
 * Board reset logic extracted for testability.
 *
 * "Resetting the board" means clearing the live Space status so the board
 * appears empty at the start of a new day. It does NOT delete CallEvent rows —
 * those are the persistent historical log that backs /admin/history and must
 * survive indefinitely across resets (see #74).
 *
 * The raw D1 batch interface is used because D1's Prisma adapter ignores
 * $transaction; the caller obtains the D1 binding from context and invokes
 * `d1.batch(buildBoardResetBatch(d1, orgId, nowIso))`. `D1Database` and
 * `D1PreparedStatement` are the ambient Cloudflare Workers types, so the result
 * is directly assignable to `d1.batch(...)`.
 */

/**
 * Build the D1 batch statements for a board reset.
 *
 * Statements:
 *   1. Reset all Space rows for this org to EMPTY (clears the live board).
 *   2. Stamp AppSettings.lastBoardResetAt for the dashboard "Reset at 7:32am"
 *      indicator.
 *
 * Deliberately omitted: any DELETE on CallEvent. CallEvent is the permanent
 * pickup history — deleting it on reset was the root cause of #74.
 */
export function buildBoardResetBatch(
  d1: D1Database,
  orgId: string,
  nowIso: string,
): D1PreparedStatement[] {
  return [
    d1
      .prepare('UPDATE "Space" SET status = ?, timestamp = NULL WHERE orgId = ?')
      .bind("EMPTY", orgId),
    d1
      .prepare(
        'INSERT INTO "AppSettings" ("orgId", "viewerDrawingEnabled", "lastBoardResetAt") VALUES (?, 0, ?) ON CONFLICT("orgId") DO UPDATE SET "lastBoardResetAt" = excluded."lastBoardResetAt"',
      )
      .bind(orgId, nowIso),
  ];
}
