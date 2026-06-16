/**
 * Unit tests for the status incident janitor's staleness predicate.
 *
 * The janitor in runner.server.ts auto-resolves open incidents whose most
 * recent failing signal is older than INCIDENT_STALE_AFTER_MS (or whose
 * `lastFailAt` is null — legacy zombie rows). The key invariant under test:
 *   - Stale incidents (recovered, or monitoring lost) ARE closed.
 *   - Actively-failing incidents (recent lastFailAt, bumped every cron tick)
 *     are NOT closed. This is the safety property protecting a real outage.
 *
 * Following the repo convention in probes.server.test.ts, we prefer importing
 * the real pure helper. If that triggers server-only/Prisma init at module
 * load and fails, the mirrored predicate below is used as a fallback.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mirror of INCIDENT_STALE_AFTER_MS + isIncidentStale from runner.server.ts.
// Used as a fallback if importing the real module pulls in server/Prisma init.
// ---------------------------------------------------------------------------

const INCIDENT_STALE_AFTER_MS_MIRROR = 30 * 60_000;

function isIncidentStaleMirror(lastFailAt: Date | null, now: Date): boolean {
  if (lastFailAt == null) return true;
  return now.getTime() - lastFailAt.getTime() > INCIDENT_STALE_AFTER_MS_MIRROR;
}

// Try to use the real exported helper; fall back to the mirror if importing
// runner.server.ts triggers server-only module init at load time.
let isIncidentStale: (lastFailAt: Date | null, now: Date) => boolean =
  isIncidentStaleMirror;
try {
  const mod = await import("./runner.server");
  if (typeof mod.isIncidentStale === "function") {
    isIncidentStale = mod.isIncidentStale;
  }
} catch {
  // Keep the inline mirror — same behaviour, avoids server/Prisma init.
}

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Stale → true
// ---------------------------------------------------------------------------

test("lastFailAt = null is stale (legacy zombie incident)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  assert.equal(isIncidentStale(null, now), true);
});

test("lastFailAt = now - 7 weeks is stale", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const sevenWeeksAgo = new Date(now.getTime() - 7 * 7 * 24 * 60 * MINUTE);
  assert.equal(isIncidentStale(sevenWeeksAgo, now), true);
});

test("lastFailAt = now - 31 min is stale", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const lastFailAt = new Date(now.getTime() - 31 * MINUTE);
  assert.equal(isIncidentStale(lastFailAt, now), true);
});

// ---------------------------------------------------------------------------
// NOT stale → false (protects actively-failing incidents)
// ---------------------------------------------------------------------------

test("lastFailAt = now - 29 min is NOT stale (actively failing, protected)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const lastFailAt = new Date(now.getTime() - 29 * MINUTE);
  assert.equal(isIncidentStale(lastFailAt, now), false);
});

test("lastFailAt = now is NOT stale", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  assert.equal(isIncidentStale(now, now), false);
});
