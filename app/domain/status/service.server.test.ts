/**
 * Unit tests for the public /status page current-status staleness guard.
 *
 * The key regression: components computed their currentStatus from their
 * LATEST StatusCheck row regardless of age. Stale "outage" rows (some ~7 weeks
 * old) pinned the page to a false "Major outage". The fix forces "unknown"
 * once the latest check is older than the freshness window — a lost signal
 * must never keep the page pinned to a stale status.
 *
 * Importing service.server.ts triggers server-only init (db.server pulls in the
 * generated Prisma client / env bindings), so — following the convention in
 * probes.server.test.ts — we mirror the pure resolveCurrentStatus +
 * CHECK_STALE_AFTER_MS logic inline and test the mirror.
 */

import test from "node:test";
import assert from "node:assert/strict";

type ComponentStatus = "operational" | "degraded" | "outage" | "unknown";

// Mirrors CHECK_STALE_AFTER_MS in service.server.ts exactly.
const CHECK_STALE_AFTER_MS = 15 * 60_000;

/** Mirrors normalizeStatus in service.server.ts exactly. */
function normalizeStatus(raw: string): ComponentStatus {
  if (
    raw === "operational" ||
    raw === "degraded" ||
    raw === "outage" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return "unknown";
}

/** Mirrors resolveCurrentStatus in service.server.ts exactly. */
function resolveCurrentStatus(
  latest: { status: string; checkedAt: Date } | undefined,
  now: Date,
): ComponentStatus {
  if (!latest) return "unknown";
  if (now.getTime() - latest.checkedAt.getTime() > CHECK_STALE_AFTER_MS) {
    return "unknown";
  }
  return normalizeStatus(latest.status);
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const MIN = 60_000;

// ---------------------------------------------------------------------------
// Fresh checks keep their stored status.
// ---------------------------------------------------------------------------

test("fresh operational check (checkedAt = now) → operational", () => {
  const latest = { status: "operational", checkedAt: NOW };
  assert.equal(resolveCurrentStatus(latest, NOW), "operational");
});

// ---------------------------------------------------------------------------
// KEY REGRESSION: a stale outage row no longer pins the page to outage.
// ---------------------------------------------------------------------------

test("stale outage check (checkedAt = now - 60 min) → unknown", () => {
  const latest = { status: "outage", checkedAt: ago(60 * MIN) };
  const result = resolveCurrentStatus(latest, NOW);
  assert.equal(result, "unknown");
  assert.notEqual(result, "outage");
});

test("stale operational check (checkedAt = now - 60 min) → unknown", () => {
  const latest = { status: "operational", checkedAt: ago(60 * MIN) };
  assert.equal(resolveCurrentStatus(latest, NOW), "unknown");
});

// ---------------------------------------------------------------------------
// No data → unknown.
// ---------------------------------------------------------------------------

test("undefined latest → unknown", () => {
  assert.equal(resolveCurrentStatus(undefined, NOW), "unknown");
});

// ---------------------------------------------------------------------------
// Window boundary.
// ---------------------------------------------------------------------------

test("check just inside the window (now - 14 min) → keeps its status", () => {
  const latest = { status: "degraded", checkedAt: ago(14 * MIN) };
  assert.equal(resolveCurrentStatus(latest, NOW), "degraded");
});

test("check just outside the window (now - 16 min) → unknown", () => {
  const latest = { status: "operational", checkedAt: ago(16 * MIN) };
  assert.equal(resolveCurrentStatus(latest, NOW), "unknown");
});

// ---------------------------------------------------------------------------
// Exact boundary: stale only when strictly older than the window.
// ---------------------------------------------------------------------------

test("check exactly at the window edge (now - 15 min) → keeps its status", () => {
  const latest = { status: "operational", checkedAt: ago(CHECK_STALE_AFTER_MS) };
  assert.equal(resolveCurrentStatus(latest, NOW), "operational");
});

// ---------------------------------------------------------------------------
// Unrecognized stored status normalizes to unknown even when fresh.
// ---------------------------------------------------------------------------

test("fresh check with unrecognized status → unknown", () => {
  const latest = { status: "bogus", checkedAt: NOW };
  assert.equal(resolveCurrentStatus(latest, NOW), "unknown");
});
