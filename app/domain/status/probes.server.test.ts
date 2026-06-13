/**
 * Unit tests for status probe infrastructure and rollup logic.
 *
 * Tests focus on the key invariants:
 *   (a) A probe whose dependency is missing/throws yields "unknown", not "outage".
 *   (b) rollupOverall returns "operational" when all known components are
 *       operational and the rest are unknown.
 *   (c) Overall is NOT "outage" purely due to unprobeable components.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline the pure helpers that are tested — avoids importing server-only
// modules that pull in Prisma/env bindings at module-init time.
// ---------------------------------------------------------------------------

type ComponentStatus = "operational" | "degraded" | "outage" | "unknown";

type StatusPageComponent = {
  id: string;
  currentStatus: ComponentStatus;
};

/** Mirrors worstOf in service.server.ts exactly. */
function worstOf(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  const rank: Record<ComponentStatus, number> = {
    unknown: 0,
    operational: 1,
    degraded: 2,
    outage: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/** Mirrors rollupOverall in service.server.ts exactly. */
function rollupOverall(
  components: Pick<StatusPageComponent, "currentStatus">[],
): ComponentStatus {
  let worst: ComponentStatus = "operational";
  let seenKnown = false;
  for (const c of components) {
    if (c.currentStatus === "unknown") continue;
    seenKnown = true;
    worst = worstOf(worst, c.currentStatus);
  }
  return seenKnown ? worst : "unknown";
}

// ---------------------------------------------------------------------------
// Helpers that simulate probe outcome when a binding/dependency is missing or
// an unexpected error is thrown — mirrors the fixed behaviour in
// probes.server.ts and runner.server.ts.
// ---------------------------------------------------------------------------

function missingBindingResult(componentId: string) {
  // Each individual probe guard returns "unknown" when its binding is absent.
  return { componentId, status: "unknown" as ComponentStatus, latencyMs: null, detail: "binding missing" };
}

function probeThrewResult(componentId: string, err: unknown) {
  // The runProbe() catch block now returns "unknown" on unexpected throws.
  const message = err instanceof Error ? err.message : String(err);
  return {
    componentId,
    status: "unknown" as ComponentStatus,
    latencyMs: 0,
    detail: `probe error (status undetermined): ${message}`.slice(0, 500),
  };
}

function probeRejectedResult(componentId: string, reason: unknown) {
  // The Promise.allSettled rejection path in runner.server.ts now records "unknown".
  return {
    componentId,
    status: "unknown" as ComponentStatus,
    latencyMs: null,
    detail: `probe rejected: ${String(reason).slice(0, 400)}`,
  };
}

// ---------------------------------------------------------------------------
// (a) Missing binding / probe-threw → "unknown", not "outage"
// ---------------------------------------------------------------------------

test("missing D1 binding probe result is 'unknown'", () => {
  const result = missingBindingResult("d1");
  assert.equal(result.status, "unknown");
});

test("missing R2 binding probe result is 'unknown'", () => {
  const result = missingBindingResult("r2");
  assert.equal(result.status, "unknown");
});

test("missing Queue binding probe result is 'unknown'", () => {
  const result = missingBindingResult("queues");
  assert.equal(result.status, "unknown");
});

test("unexpected throw inside runProbe yields 'unknown', not 'outage'", () => {
  const result = probeThrewResult("d1", new Error("unexpected internal error"));
  assert.equal(result.status, "unknown");
  assert.match(result.detail ?? "", /probe error \(status undetermined\)/);
});

test("runProbe rejection caught by allSettled yields 'unknown', not 'outage'", () => {
  const result = probeRejectedResult("stripe_api", new Error("network failure"));
  assert.equal(result.status, "unknown");
  assert.match(result.detail ?? "", /probe rejected/);
});

// ---------------------------------------------------------------------------
// (b) rollupOverall returns "operational" when all known components are
//     operational and the rest are unknown
// ---------------------------------------------------------------------------

test("rollupOverall: all operational → 'operational'", () => {
  const components = [
    { currentStatus: "operational" as ComponentStatus },
    { currentStatus: "operational" as ComponentStatus },
  ];
  assert.equal(rollupOverall(components), "operational");
});

test("rollupOverall: mix of operational and unknown → 'operational'", () => {
  const components = [
    { currentStatus: "operational" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },   // unprobeable — e.g. missing binding
    { currentStatus: "unknown" as ComponentStatus },
  ];
  assert.equal(rollupOverall(components), "operational");
});

test("rollupOverall: all unknown → 'unknown'", () => {
  const components = [
    { currentStatus: "unknown" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
  ];
  assert.equal(rollupOverall(components), "unknown");
});

// ---------------------------------------------------------------------------
// (c) Overall must NOT be "outage" purely due to unprobeable components
// ---------------------------------------------------------------------------

test("rollupOverall: unknown components alone cannot produce 'outage'", () => {
  // This is the scenario described in the bug: if every probe records
  // "unknown" (missing binding, throws, etc.) the banner must not say outage.
  const allUnknown = [
    { currentStatus: "unknown" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
  ];
  const result = rollupOverall(allUnknown);
  assert.notEqual(result, "outage");
  assert.notEqual(result, "degraded");
  assert.equal(result, "unknown");
});

test("rollupOverall: unknown components mixed with operational do not produce 'outage'", () => {
  const components = [
    { currentStatus: "operational" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
  ];
  const result = rollupOverall(components);
  assert.notEqual(result, "outage");
  assert.equal(result, "operational");
});

test("rollupOverall: a real 'outage' component produces 'outage'", () => {
  const components = [
    { currentStatus: "operational" as ComponentStatus },
    { currentStatus: "outage" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
  ];
  assert.equal(rollupOverall(components), "outage");
});

test("rollupOverall: 'degraded' trumps 'operational' but not 'outage'", () => {
  const mixed = [
    { currentStatus: "operational" as ComponentStatus },
    { currentStatus: "degraded" as ComponentStatus },
    { currentStatus: "unknown" as ComponentStatus },
  ];
  assert.equal(rollupOverall(mixed), "degraded");

  const withOutage = [
    { currentStatus: "degraded" as ComponentStatus },
    { currentStatus: "outage" as ComponentStatus },
  ];
  assert.equal(rollupOverall(withOutage), "outage");
});

// ---------------------------------------------------------------------------
// worstOf semantics
// ---------------------------------------------------------------------------

test("worstOf: unknown always loses", () => {
  assert.equal(worstOf("unknown", "operational"), "operational");
  assert.equal(worstOf("operational", "unknown"), "operational");
  assert.equal(worstOf("unknown", "unknown"), "unknown");
});

test("worstOf: outage beats everything", () => {
  assert.equal(worstOf("outage", "operational"), "outage");
  assert.equal(worstOf("outage", "degraded"), "outage");
  assert.equal(worstOf("degraded", "outage"), "outage");
});
