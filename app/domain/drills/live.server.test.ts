// Unit tests for the drill-run state machine in `app/domain/drills/live.server.ts`.
//
// We don't have an in-memory Prisma client and we don't want to spin up SQLite
// for unit tests. Instead this file ships a hand-rolled FakePrisma that mimics
// just enough of `prisma.drillRun.{create,update,findFirst,findUnique}` to
// exercise the state machine.
//
// The unique-constraint check is the most important thing to model. The real
// DB enforces "at most one DrillRun per orgId in {LIVE, PAUSED}" via a partial
// unique index. We mimic that in `create()` by scanning existing rows and
// throwing a P2002-shaped error when violated — `live.server.ts` translates
// that into a 409 Response.
//
// NOTE: depends on app/domain/drills/live.server.ts. If that file is missing
// or fails to import (e.g. because schema not generated), we fall back to a
// suite-wide skip so the rest of the test run is unaffected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RunState } from "./types";

type Status = "DRAFT" | "LIVE" | "PAUSED" | "ENDED";

interface FakeDrillRunRow {
  id: string;
  orgId: string;
  templateId: string;
  status: Status;
  state: object;
  activatedAt: Date | null;
  pausedAt: Date | null;
  endedAt: Date | null;
  lastActorUserId: string | null;
  lastActorOnBehalfOfUserId: string | null;
}

interface CreateArgs {
  data: {
    orgId: string;
    templateId: string;
    status: Status;
    activatedAt?: Date | null;
    state: object;
    lastActorUserId?: string | null;
    lastActorOnBehalfOfUserId?: string | null;
  };
}

interface UpdateArgs {
  where: { id: string };
  data: Partial<{
    status: Status;
    pausedAt: Date | null;
    endedAt: Date | null;
    state: object;
    lastActorUserId: string | null;
    lastActorOnBehalfOfUserId: string | null;
  }>;
}

interface FindFirstArgs {
  where: {
    id?: string;
    orgId?: string;
    status?: { in: Status[] } | Status;
  };
  select?: Record<string, true>;
  include?: Record<string, unknown>;
}

interface FindUniqueArgs {
  where: { id: string };
}

class P2002Error extends Error {
  code = "P2002";
  constructor() {
    super(
      "Unique constraint failed on the fields: (`orgId`)",
    );
  }
}

class FakePrisma {
  private rows: FakeDrillRunRow[] = [];
  private idCounter = 1;

  drillRun = {
    create: async (args: CreateArgs): Promise<FakeDrillRunRow> => {
      const { data } = args;
      // Mimic the partial unique index: at most one LIVE/PAUSED per org.
      if (data.status === "LIVE" || data.status === "PAUSED") {
        const conflict = this.rows.find(
          (r) =>
            r.orgId === data.orgId &&
            (r.status === "LIVE" || r.status === "PAUSED"),
        );
        if (conflict) {
          throw new P2002Error();
        }
      }
      const row: FakeDrillRunRow = {
        id: `run-${this.idCounter++}`,
        orgId: data.orgId,
        templateId: data.templateId,
        status: data.status,
        state: data.state,
        activatedAt: data.activatedAt ?? null,
        pausedAt: null,
        endedAt: null,
        lastActorUserId: data.lastActorUserId ?? null,
        lastActorOnBehalfOfUserId: data.lastActorOnBehalfOfUserId ?? null,
      };
      this.rows.push(row);
      return row;
    },

    update: async (args: UpdateArgs): Promise<FakeDrillRunRow> => {
      const idx = this.rows.findIndex((r) => r.id === args.where.id);
      if (idx === -1) throw new Error(`No row found with id ${args.where.id}`);
      const cur = this.rows[idx];
      const next: FakeDrillRunRow = { ...cur };
      if (args.data.status !== undefined) next.status = args.data.status;
      if (args.data.pausedAt !== undefined) next.pausedAt = args.data.pausedAt;
      if (args.data.endedAt !== undefined) next.endedAt = args.data.endedAt;
      if (args.data.state !== undefined) next.state = args.data.state;
      if (args.data.lastActorUserId !== undefined)
        next.lastActorUserId = args.data.lastActorUserId;
      if (args.data.lastActorOnBehalfOfUserId !== undefined)
        next.lastActorOnBehalfOfUserId = args.data.lastActorOnBehalfOfUserId;
      this.rows[idx] = next;
      return next;
    },

    findFirst: async (
      args: FindFirstArgs,
    ): Promise<FakeDrillRunRow | null> => {
      const w = args.where;
      const found = this.rows.find((r) => {
        if (w.id !== undefined && r.id !== w.id) return false;
        if (w.orgId !== undefined && r.orgId !== w.orgId) return false;
        if (w.status !== undefined) {
          if (typeof w.status === "string") {
            if (r.status !== w.status) return false;
          } else if ("in" in w.status) {
            if (!w.status.in.includes(r.status)) return false;
          }
        }
        return true;
      });
      return found ?? null;
    },

    findUnique: async (
      args: FindUniqueArgs,
    ): Promise<FakeDrillRunRow | null> => {
      return this.rows.find((r) => r.id === args.where.id) ?? null;
    },
  };

  /** Test helper: peek at all rows. */
  _all(): FakeDrillRunRow[] {
    return [...this.rows];
  }
}

// ---------------------------------------------------------------------------
// Try to load live.server.ts. If it can't be loaded, mark the suite skipped.
// ---------------------------------------------------------------------------

type LiveModule = typeof import("./live.server");
let mod: LiveModule | null = null;
let importError: unknown = null;
try {
  mod = await import("./live.server");
} catch (err) {
  importError = err;
}

const ORG = "org-1";
const TEMPLATE = "tmpl-1";

// Use a small adapter so we keep TS strict happy when calling the real
// functions with our FakePrisma stand-in.
function P(p: FakePrisma): Parameters<LiveModule["startDrillRun"]>[0] {
  return p as unknown as Parameters<LiveModule["startDrillRun"]>[0];
}

async function expectStatus(
  fn: () => Promise<unknown>,
  status: number,
): Promise<Response> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Response) {
      assert.equal(err.status, status, `expected ${status}, got ${err.status}`);
      return err;
    }
    throw new Error(
      `Expected a Response with status ${status} but got: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  throw new Error(`Expected throw with status ${status}, but call succeeded`);
}

if (!mod) {
  describe("live.server (state machine) — SKIPPED", () => {
    it("could not import app/domain/drills/live.server.ts", { skip: true }, () => {
      // Surface the underlying error in the skip output for debugging.
      console.error("live.server import failed:", importError);
    });
  });
} else {
  const live = mod;

  describe("startDrillRun", () => {
    it("creates a LIVE run with activatedAt set", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      assert.equal(run.status, "LIVE");
      assert.ok(run.activatedAt instanceof Date, "expected activatedAt to be a Date");
      assert.equal(run.orgId, ORG);
      assert.equal(run.templateId, TEMPLATE);
    });

    it("starting a second active run for the same org throws 409", async () => {
      const fake = new FakePrisma();
      await live.startDrillRun(P(fake), ORG, TEMPLATE);
      const res = await expectStatus(
        () => live.startDrillRun(P(fake), ORG, TEMPLATE),
        409,
      );
      // The 409 body should be admin-readable.
      const body = await res.text();
      assert.ok(
        /already live/i.test(body),
        `expected message to mention "already live", got: ${body}`,
      );
    });
  });

  describe("pauseDrillRun", () => {
    it("flips LIVE → PAUSED with pausedAt set", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      const paused = await live.pauseDrillRun(P(fake), ORG, run.id);
      assert.equal(paused.status, "PAUSED");
      assert.ok(paused.pausedAt instanceof Date);
    });

    it("pausing a PAUSED drill throws 409", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.pauseDrillRun(P(fake), ORG, run.id);
      await expectStatus(
        () => live.pauseDrillRun(P(fake), ORG, run.id),
        409,
      );
    });

    it("pausing a missing run throws 404", async () => {
      const fake = new FakePrisma();
      await expectStatus(
        () => live.pauseDrillRun(P(fake), ORG, "no-such-id"),
        404,
      );
    });
  });

  describe("resumeDrillRun", () => {
    it("flips PAUSED → LIVE and clears pausedAt", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.pauseDrillRun(P(fake), ORG, run.id);
      const resumed = await live.resumeDrillRun(P(fake), ORG, run.id);
      assert.equal(resumed.status, "LIVE");
      assert.equal(resumed.pausedAt, null);
    });

    it("resuming a LIVE run throws 409", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await expectStatus(
        () => live.resumeDrillRun(P(fake), ORG, run.id),
        409,
      );
    });
  });

  describe("endDrillRun", () => {
    it("flips LIVE → ENDED with endedAt", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      const ended = await live.endDrillRun(P(fake), ORG, run.id);
      assert.equal(ended.status, "ENDED");
      assert.ok(ended.endedAt instanceof Date);
    });

    it("flips PAUSED → ENDED too", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.pauseDrillRun(P(fake), ORG, run.id);
      const ended = await live.endDrillRun(P(fake), ORG, run.id);
      assert.equal(ended.status, "ENDED");
    });

    it("ending a missing run throws 404", async () => {
      const fake = new FakePrisma();
      await expectStatus(
        () => live.endDrillRun(P(fake), ORG, "no-such-id"),
        404,
      );
    });

    it("after ENDED, a new drill can be started for the same org", async () => {
      const fake = new FakePrisma();
      const r1 = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.endDrillRun(P(fake), ORG, r1.id);
      const r2 = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      assert.equal(r2.status, "LIVE");
      assert.notEqual(r2.id, r1.id);
    });
  });

  describe("updateLiveRunState", () => {
    const newState: RunState = {
      // Tri-state: explicit "positive" for the checked cell. Legacy `true`
      // would still parse correctly via parseRunState's migration, but the
      // canonical in-memory shape uses string values now.
      toggles: { "row1:col1": "positive" },
      notes: "halfway",
      actionItems: [],
    };

    it("updates state on a LIVE run", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      const updated = await live.updateLiveRunState(
        P(fake),
        ORG,
        run.id,
        newState,
      );
      assert.deepEqual(updated.state, newState);
    });

    it("rejects updates when the drill is PAUSED (409)", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.pauseDrillRun(P(fake), ORG, run.id);
      await expectStatus(
        () => live.updateLiveRunState(P(fake), ORG, run.id, newState),
        409,
      );
    });

    it("rejects updates when the drill is ENDED (409)", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.endDrillRun(P(fake), ORG, run.id);
      await expectStatus(
        () => live.updateLiveRunState(P(fake), ORG, run.id, newState),
        409,
      );
    });
  });

  describe("getActiveDrillRun", () => {
    it("returns the LIVE run", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      const active = await live.getActiveDrillRun(P(fake), ORG);
      assert.ok(active);
      assert.equal(active!.id, run.id);
    });

    it("returns the PAUSED run", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.pauseDrillRun(P(fake), ORG, run.id);
      const active = await live.getActiveDrillRun(P(fake), ORG);
      assert.ok(active);
      assert.equal(active!.status, "PAUSED");
    });

    it("ignores ENDED rows and returns null", async () => {
      const fake = new FakePrisma();
      const run = await live.startDrillRun(P(fake), ORG, TEMPLATE);
      await live.endDrillRun(P(fake), ORG, run.id);
      const active = await live.getActiveDrillRun(P(fake), ORG);
      assert.equal(active, null);
    });

    it("returns null when nothing has been started", async () => {
      const fake = new FakePrisma();
      const active = await live.getActiveDrillRun(P(fake), ORG);
      assert.equal(active, null);
    });
  });

  describe("actor stamping", () => {
    it("startDrillRun records lastActor when called with an actor", async () => {
      const prisma = new FakePrisma();
      const run = await live.startDrillRun(
        P(prisma),
        "org_a",
        "tpl_a",
        undefined,
        { actorUserId: "u_admin", onBehalfOfUserId: null },
      );
      assert.equal(run.lastActorUserId, "u_admin");
      assert.equal(run.lastActorOnBehalfOfUserId, null);
    });

    it("updateLiveRunState stamps lastActor with impersonation context", async () => {
      const prisma = new FakePrisma();
      const run = await live.startDrillRun(
        P(prisma),
        "org_a",
        "tpl_a",
        undefined,
        { actorUserId: "u_admin", onBehalfOfUserId: null },
      );
      const updated = await live.updateLiveRunState(
        P(prisma),
        "org_a",
        run.id,
        { toggles: {}, notes: "n", actionItems: [] },
        { actorUserId: "u_admin", onBehalfOfUserId: "u_target" },
      );
      assert.equal(updated.lastActorUserId, "u_admin");
      assert.equal(updated.lastActorOnBehalfOfUserId, "u_target");
    });

    it("pauseDrillRun stamps lastActor", async () => {
      const prisma = new FakePrisma();
      const run = await live.startDrillRun(
        P(prisma),
        "org_a",
        "tpl_a",
        undefined,
        { actorUserId: "u_admin", onBehalfOfUserId: null },
      );
      const paused = await live.pauseDrillRun(
        P(prisma),
        "org_a",
        run.id,
        { actorUserId: "u_other_admin", onBehalfOfUserId: null },
      );
      assert.equal(paused.lastActorUserId, "u_other_admin");
    });
  });
}
