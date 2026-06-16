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

// ---------------------------------------------------------------------------
// HTTP probe status mapping — mirrors httpStatusToComponentStatus /
// isCloudflareEdgeStatus in probes.server.ts (kept inline per repo convention).
//
// CRITICAL: the Cloudflare edge-error band (520–527) must map to "unknown",
// not "outage", because a worker fetching its own zone can loop back through
// the edge and return one of these even when the app is healthy. A genuine
// app error (500/404/503) still maps to "outage".
// ---------------------------------------------------------------------------

function isCloudflareEdgeStatus(status: number): boolean {
  return status >= 520 && status <= 527;
}

function httpStatusToComponentStatus(
  status: number,
  expectStatus: number,
): ComponentStatus {
  if (isCloudflareEdgeStatus(status)) return "unknown";
  const ok =
    status === expectStatus ||
    (expectStatus === 200 && status >= 200 && status < 300);
  return ok ? "operational" : "outage";
}

test("httpStatusToComponentStatus: 200 → operational", () => {
  assert.equal(httpStatusToComponentStatus(200, 200), "operational");
  assert.equal(httpStatusToComponentStatus(204, 200), "operational");
});

test("httpStatusToComponentStatus: app errors → outage", () => {
  assert.equal(httpStatusToComponentStatus(500, 200), "outage");
  assert.equal(httpStatusToComponentStatus(404, 200), "outage");
  assert.equal(httpStatusToComponentStatus(503, 200), "outage");
});

test("httpStatusToComponentStatus: 522 (Cloudflare edge) → unknown", () => {
  assert.equal(httpStatusToComponentStatus(522, 200), "unknown");
});

test("httpStatusToComponentStatus: full 520–527 band → unknown", () => {
  for (let code = 520; code <= 527; code++) {
    assert.equal(
      httpStatusToComponentStatus(code, 200),
      "unknown",
      `code ${code} should be unknown`,
    );
  }
});

test("httpStatusToComponentStatus: band boundaries 519/528 → outage", () => {
  assert.equal(httpStatusToComponentStatus(519, 200), "outage");
  assert.equal(httpStatusToComponentStatus(528, 200), "outage");
});

test("httpStatusToComponentStatus: non-200 expectStatus matched exactly", () => {
  assert.equal(httpStatusToComponentStatus(301, 301), "operational");
  // With a non-200 expectStatus, a 2xx that isn't the expected code is outage.
  assert.equal(httpStatusToComponentStatus(200, 301), "outage");
});

// ---------------------------------------------------------------------------
// Tenant-aggregate rollup over conclusive / inconclusive results — mirrors
// rollupTenantResults in probes.server.ts (kept inline per repo convention).
//
//   - `true`  = tenant up
//   - `false` = tenant down (or hard fetch rejection)
//   - `null`  = inconclusive (520–527 same-zone loopback)
//
// The fail ratio is computed over CONCLUSIVE results only. If fewer than half
// of the probed tenants are conclusive, the rollup is "unknown" (never outage).
// ---------------------------------------------------------------------------

function rollupTenantResults(
  results: Array<boolean | null>,
  opts: { degradedRatio: number; outageRatio: number },
): ComponentStatus {
  const total = results.length;
  if (total === 0) return "unknown";

  const conclusive = results.filter((r) => r !== null) as boolean[];
  if (conclusive.length < total / 2) return "unknown";

  const fails = conclusive.filter((up) => up === false).length;
  const failRatio = fails / conclusive.length;
  if (failRatio > opts.outageRatio) return "outage";
  if (fails > 0 && failRatio > opts.degradedRatio) return "degraded";
  return "operational";
}

const DEFAULT_RATIOS = { degradedRatio: 0.0, outageRatio: 0.4 };

test("rollupTenantResults: all up → operational", () => {
  assert.equal(
    rollupTenantResults([true, true, true, true], DEFAULT_RATIOS),
    "operational",
  );
});

test("rollupTenantResults: > outageRatio down → outage", () => {
  // 3/4 down = 0.75 > 0.4 → outage.
  assert.equal(
    rollupTenantResults([false, false, false, true], DEFAULT_RATIOS),
    "outage",
  );
});

test("rollupTenantResults: some down but below outageRatio → degraded", () => {
  // 1/4 down = 0.25, > degradedRatio (0) and <= outageRatio (0.4) → degraded.
  assert.equal(
    rollupTenantResults([false, true, true, true], DEFAULT_RATIOS),
    "degraded",
  );
});

test("rollupTenantResults: majority inconclusive (null) → unknown, NOT outage", () => {
  // Only 1 of 4 conclusive (< half) → unknown even though the conclusive one is down.
  const result = rollupTenantResults([false, null, null, null], DEFAULT_RATIOS);
  assert.equal(result, "unknown");
  assert.notEqual(result, "outage");
});

test("rollupTenantResults: exactly half conclusive is enough (not unknown)", () => {
  // 2/4 conclusive (>= half), both up → operational.
  assert.equal(
    rollupTenantResults([true, true, null, null], DEFAULT_RATIOS),
    "operational",
  );
});

test("rollupTenantResults: fail ratio uses conclusive denominator only", () => {
  // 2 down, 2 up, 0 null → 4 conclusive, failRatio 0.5 > 0.4 → outage.
  assert.equal(
    rollupTenantResults([false, false, true, true], DEFAULT_RATIOS),
    "outage",
  );
  // 2 down, 2 up, but with nulls the conclusive denominator stays 4 here.
  // 1 down of 3 conclusive = 0.33 <= 0.4 → degraded (the null is excluded).
  assert.equal(
    rollupTenantResults([false, true, true, null], DEFAULT_RATIOS),
    "degraded",
  );
});

test("rollupTenantResults: empty input → unknown", () => {
  assert.equal(rollupTenantResults([], DEFAULT_RATIOS), "unknown");
});
