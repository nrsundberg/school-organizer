import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTrialStatus,
  applyTrialEvaluation,
  type TrialEvaluation,
  type TrialLifecyclePrisma,
  type TrialLifecycleOrg,
} from "./trial-lifecycle.server";

const NOW = new Date("2026-04-29T12:00:00Z");

type CallEventRow = {
  orgId: string;
  studentId: number | null;
  createdAt: Date;
};

type OrgRow = TrialLifecycleOrg;

function buildPrisma(state: {
  callEvents: CallEventRow[];
  orgs: OrgRow[];
}): TrialLifecyclePrisma {
  const orgUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    callEvent: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        const where = (args.where ?? {}) as {
          orgId?: string;
          studentId?: { not?: null };
          createdAt?: { gte?: Date };
        };
        return state.callEvents.filter((e) => {
          if (where.orgId && e.orgId !== where.orgId) return false;
          if (where.studentId?.not === null && e.studentId == null) return false;
          if (where.createdAt?.gte && e.createdAt < where.createdAt.gte) return false;
          return true;
        });
      },
    },
    org: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        orgUpdates.push({ id: args.where.id, data: args.data });
        const org = state.orgs.find((o) => o.id === args.where.id);
        if (org) Object.assign(org, args.data);
        return org;
      },
      __updates: orgUpdates,
    },
  } as unknown as TrialLifecyclePrisma & { org: { __updates: typeof orgUpdates } };
}

function getUpdates(prisma: unknown): Array<{ id: string; data: Record<string, unknown> }> {
  return ((prisma as { org: { __updates: unknown[] } }).org.__updates) as Array<{
    id: string;
    data: Record<string, unknown>;
  }>;
}

const baseOrg = (overrides: Partial<OrgRow> = {}): OrgRow => ({
  id: "org_1",
  status: "TRIALING",
  billingPlan: "FREE",
  trialStartedAt: new Date("2026-04-01T00:00:00Z"), // 28 days ago
  trialEndsAt: new Date("2026-05-01T00:00:00Z"),
  trialQualifyingPickupDays: 5,
  compedUntil: null,
  isComped: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// evaluateTrialStatus
// ---------------------------------------------------------------------------

test("evaluateTrialStatus: paid plan → not_applicable", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ billingPlan: "CAR_LINE" }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "not_applicable");
  if (ev.kind === "not_applicable") assert.equal(ev.reason, "paid_plan");
});

test("evaluateTrialStatus: no trialStartedAt → not_applicable (not_started)", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ trialStartedAt: null }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "not_applicable");
  if (ev.kind === "not_applicable") assert.equal(ev.reason, "not_started");
});

test("evaluateTrialStatus: isComped → not_applicable (comped)", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ isComped: true }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "not_applicable");
  if (ev.kind === "not_applicable") assert.equal(ev.reason, "comped");
});

test("evaluateTrialStatus: compedUntil in the future → not_applicable (comped)", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ compedUntil: new Date("2026-06-01T00:00:00Z") }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "not_applicable");
  if (ev.kind === "not_applicable") assert.equal(ev.reason, "comped");
});

test("evaluateTrialStatus: not currently TRIALING → not_applicable (not_trialing)", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ status: "INCOMPLETE" }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "not_applicable");
  if (ev.kind === "not_applicable") assert.equal(ev.reason, "not_trialing");
});

test("evaluateTrialStatus: mid-window with few pickup days → active", async () => {
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(baseOrg(), prisma, NOW);
  assert.equal(ev.kind, "active");
  if (ev.kind === "active") {
    assert.ok(ev.daysRemaining > 0);
    assert.equal(ev.pickupDaysRemaining, 25);
  }
});

test("evaluateTrialStatus: 30-day window passed but pickup-days threshold unmet → still active", async () => {
  // start = 35 days ago, no qualifying call events, status TRIALING.
  const prisma = buildPrisma({ callEvents: [], orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({
      trialStartedAt: new Date(NOW.getTime() - 35 * 86_400_000),
      trialEndsAt: new Date(NOW.getTime() - 5 * 86_400_000),
    }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "active");
});

test("evaluateTrialStatus: both thresholds met → should_end", async () => {
  // Build 26 distinct UTC days each with 11 distinct students > qualifying threshold.
  const start = new Date("2026-03-01T00:00:00Z");
  const callEvents: CallEventRow[] = [];
  for (let day = 0; day < 26; day++) {
    const created = new Date(start.getTime() + day * 86_400_000 + 60_000);
    for (let s = 0; s < 11; s++) {
      callEvents.push({ orgId: "org_1", studentId: 1000 + s, createdAt: created });
    }
  }
  const prisma = buildPrisma({ callEvents, orgs: [] });
  const ev = await evaluateTrialStatus(
    baseOrg({ trialStartedAt: start }),
    prisma,
    NOW,
  );
  assert.equal(ev.kind, "should_end");
  if (ev.kind === "should_end") {
    assert.equal(ev.reason, "BOTH_THRESHOLDS_MET");
  }
});

// ---------------------------------------------------------------------------
// applyTrialEvaluation
// ---------------------------------------------------------------------------

test("applyTrialEvaluation: not_applicable is a no-op", async () => {
  const orgs: OrgRow[] = [baseOrg()];
  const prisma = buildPrisma({ callEvents: [], orgs });
  const ev: TrialEvaluation = { kind: "not_applicable", reason: "paid_plan" };
  const { changed } = await applyTrialEvaluation(prisma, "org_1", ev);
  assert.equal(changed, false);
  assert.equal(getUpdates(prisma).length, 0);
});

test("applyTrialEvaluation: active updates trialQualifyingPickupDays and trialEndsAt", async () => {
  const orgs: OrgRow[] = [baseOrg()];
  const prisma = buildPrisma({ callEvents: [], orgs });
  const endsAt = new Date("2026-05-01T00:00:00Z");
  const ev: TrialEvaluation = {
    kind: "active",
    endsAt,
    daysRemaining: 2,
    pickupDaysRemaining: 20,
    pickupDaysUsed: 5,
  };
  const { changed } = await applyTrialEvaluation(prisma, "org_1", ev);
  assert.equal(changed, true);
  const u = getUpdates(prisma);
  assert.equal(u.length, 1);
  assert.equal(u[0].data.trialQualifyingPickupDays, 5);
  assert.equal((u[0].data.trialEndsAt as Date).getTime(), endsAt.getTime());
  assert.equal(u[0].data.status, undefined); // active does NOT flip status
});

test("applyTrialEvaluation: should_end flips status to INCOMPLETE and persists trialEndsAt", async () => {
  const orgs: OrgRow[] = [baseOrg()];
  const prisma = buildPrisma({ callEvents: [], orgs });
  const endsAt = new Date("2026-04-25T00:00:00Z");
  const ev: TrialEvaluation = {
    kind: "should_end",
    endsAt,
    reason: "BOTH_THRESHOLDS_MET",
    pickupDaysUsed: 25,
  };
  const { changed } = await applyTrialEvaluation(prisma, "org_1", ev);
  assert.equal(changed, true);
  const u = getUpdates(prisma);
  assert.equal(u.length, 1);
  assert.equal(u[0].data.status, "INCOMPLETE");
  assert.equal(u[0].data.trialQualifyingPickupDays, 25);
  assert.equal((u[0].data.trialEndsAt as Date).getTime(), endsAt.getTime());
});
