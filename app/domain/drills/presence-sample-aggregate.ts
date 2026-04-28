// Pure helpers used by the DO alarm in `workers/bingo-board.ts` to assemble
// presence snapshots from per-WebSocket attachments, and by the replay UI to
// pick the active sample for a scrub time.
//
// Kept pure / no Cloudflare / Prisma imports so they can be unit-tested
// directly with `tsx --test`.

/**
 * Shape we serializeAttachment onto each WebSocket. The DO writes one of
 * these per drillPresence message it sees so a hibernation-restart still
 * has the identity needed to build a snapshot.
 *
 * `runId` is the drill the socket is attached to; multiple runs can be
 * concurrent on the same DO (one per org) when there's been a transition.
 *
 * `at` is the wall-clock ms when the attachment was last refreshed; used
 * only for diagnostics today, but kept on the wire so future stale-pruning
 * doesn't need a schema change.
 */
export type SocketAttachment = {
  runId: string;
  userId: string;
  label: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfLabel: string | null;
  isGuest: boolean;
  color: string;
  at: number;
};

/**
 * Snapshot row for one runId. Mirrors the shape the server endpoint accepts
 * in its POST body — `viewers` is the authed-only list (guests are
 * collapsed into `guestCount`) so the stored row stays small even when a
 * viewer-pin link goes mildly viral.
 */
export type RunSnapshot = {
  runId: string;
  authedViewers: Array<{
    userId: string;
    label: string;
    onBehalfOfUserId: string | null;
    onBehalfOfLabel: string | null;
    color: string;
  }>;
  guestCount: number;
};

/**
 * Group attachments by `runId` and split each group into authed vs guest.
 * Authed entries are de-duplicated on `userId` (keeping the most recent
 * attachment by `at`) so a user with two browser tabs counts once.
 */
export function groupAttachmentsByRun(
  attachments: Iterable<SocketAttachment>,
): RunSnapshot[] {
  // runId → Map<userId, attachment>.
  const authedByRun = new Map<string, Map<string, SocketAttachment>>();
  const guestCountByRun = new Map<string, number>();

  for (const a of attachments) {
    if (!a || typeof a.runId !== "string" || a.runId.length === 0) continue;
    if (a.isGuest) {
      guestCountByRun.set(a.runId, (guestCountByRun.get(a.runId) ?? 0) + 1);
      continue;
    }
    if (!a.label) continue; // defensive: non-guest with null label is malformed
    let bucket = authedByRun.get(a.runId);
    if (!bucket) {
      bucket = new Map<string, SocketAttachment>();
      authedByRun.set(a.runId, bucket);
    }
    const existing = bucket.get(a.userId);
    if (!existing || a.at > existing.at) {
      bucket.set(a.userId, a);
    }
  }

  // Assemble result, including any runId that has only guests.
  const allRunIds = new Set<string>([
    ...authedByRun.keys(),
    ...guestCountByRun.keys(),
  ]);
  const out: RunSnapshot[] = [];
  for (const runId of allRunIds) {
    const authedMap = authedByRun.get(runId);
    const authedViewers = authedMap
      ? Array.from(authedMap.values()).map((a) => ({
          userId: a.userId,
          label: a.label as string,
          onBehalfOfUserId: a.onBehalfOfUserId,
          onBehalfOfLabel: a.onBehalfOfLabel,
          color: a.color,
        }))
      : [];
    // Stable sort by userId so the row content is deterministic — easier
    // for tests and for human eyeballing of a stored row.
    authedViewers.sort((a, b) => a.userId.localeCompare(b.userId));
    out.push({
      runId,
      authedViewers,
      guestCount: guestCountByRun.get(runId) ?? 0,
    });
  }
  // Stable run order too.
  out.sort((a, b) => a.runId.localeCompare(b.runId));
  return out;
}

// ---------------------------------------------------------------------------
// Binary-search the active sample for a replay scrub time.
// ---------------------------------------------------------------------------

/**
 * Sample shape used by the replay viewer track. Sorted by `occurredAtMs`
 * ascending; `findActiveSampleIndex` assumes that invariant.
 */
export type SampleAt<T> = T & { occurredAtMs: number };

/**
 * Return the index of the LAST sample whose `occurredAtMs <= currentTimeMs`,
 * or -1 if `currentTimeMs` precedes the first sample (or the list is empty).
 *
 * Pure binary search; O(log n) on a sample list bounded by ~120 entries for
 * an hour-long drill (one sample / 30s).
 */
export function findActiveSampleIndex<T>(
  samples: ReadonlyArray<SampleAt<T>>,
  currentTimeMs: number,
): number {
  if (samples.length === 0) return -1;
  if (currentTimeMs < samples[0].occurredAtMs) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (samples[mid].occurredAtMs <= currentTimeMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
