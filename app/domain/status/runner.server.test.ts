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
 * `isIncidentStale` is a pure helper, so we import it directly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isIncidentStale } from "./runner.server";

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
