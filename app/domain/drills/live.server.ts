import type { DrillRun, DrillRunEvent, Prisma, PrismaClient } from "~/db";
import type { ActorIds } from "~/domain/auth/impersonate-gate.server";
import {
  emptyRunState,
  parseRunState,
  type DrillAudience,
  type DrillEventPayload,
  type DrillMode,
  type RunState,
} from "./types";
import { diffRunStates } from "./replay";

/**
 * State-machine helpers for the "live drill" feature.
 *
 * Concurrency invariant: at most one DrillRun per org may be in status LIVE
 * or PAUSED at a time. The DB enforces this via the partial unique index
 * `DrillRun_one_active_per_org_idx` (see migration 0021). App code catches
 * the unique-violation and surfaces it as a 409 Response.
 *
 * All `prisma` arguments here MUST be a tenant-scoped client (i.e. obtained
 * via `getTenantPrisma(context)`), so reads/writes are auto-filtered to the
 * caller's org. We still pass `orgId` explicitly because:
 *   - tenant-scoped writes still need orgId in `data` for create
 *   - belt-and-suspenders ownership checks for state transitions
 */

/** Shape of a Prisma-thrown error we care about. Avoids importing the full
 *  Prisma error class (which is wasm-edge-only and pulls in extra weight). */
interface MaybePrismaError {
  code?: unknown;
  message?: unknown;
}

/**
 * Returns true if the given thrown value looks like the unique-constraint
 * violation that fires when we try to create a second LIVE/PAUSED DrillRun
 * for the same org.
 *
 * Two surfaces to detect:
 *   1. Prisma's `PrismaClientKnownRequestError` with `code === "P2002"`.
 *   2. The raw D1/SQLite message `UNIQUE constraint failed: DrillRun.orgId`,
 *      which can leak through when the D1 adapter doesn't translate the
 *      error into a Prisma error.
 */
function isActiveDrillUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as MaybePrismaError;
  if (e.code === "P2002") return true;
  if (typeof e.message === "string") {
    const msg = e.message;
    if (
      msg.includes("UNIQUE constraint failed: DrillRun.orgId") ||
      msg.includes("DrillRun_one_active_per_org_idx")
    ) {
      return true;
    }
  }
  return false;
}

/** Friendly 409 thrown when an admin tries to start a second active drill. */
function activeDrillConflictResponse(): Response {
  return new Response("Another drill is already live — end it first.", {
    status: 409,
  });
}

/**
 * Build a `drillRunEvent.create.data` object from a payload + actor + runId.
 * Centralized so every mutation tags events identically.
 *
 * `ipAddress` / `userAgent` are forensic-grade network context. Both default
 * to `null` so the (rare) caller without an inbound Request — e.g. tests or
 * future server-driven lifecycle transitions — can still write events.
 * Production callers thread the values through from the route boundary via
 * `getAuditContextFromRequest`.
 */
function eventCreateData(
  runId: string,
  payload: DrillEventPayload,
  actor: ActorIds,
  occurredAt: Date,
  ipAddress: string | null = null,
  userAgent: string | null = null,
): Prisma.DrillRunEventUncheckedCreateInput {
  return {
    runId,
    kind: payload.kind,
    payload: payload as unknown as Prisma.InputJsonValue,
    actorUserId: actor.actorUserId,
    onBehalfOfUserId: actor.onBehalfOfUserId,
    ipAddress,
    userAgent,
    occurredAt,
  };
}

/**
 * Look up the single LIVE or PAUSED DrillRun for the org, if any.
 *
 * Used by:
 *   - `app/root.tsx` loader to decide whether to redirect non-admins to the
 *     takeover screen.
 *   - `/drills/live` loader to render the takeover.
 *
 * Returns the run with its template included, or `null` when no drill is active.
 *
 * Preconditions: caller is signed in and `prisma` is tenant-scoped.
 */
export async function getActiveDrillRun(prisma: PrismaClient, orgId: string) {
  return prisma.drillRun.findFirst({
    where: {
      orgId,
      status: { in: ["LIVE", "PAUSED"] },
    },
    select: {
      id: true,
      status: true,
      audience: true,
      activatedAt: true,
      pausedAt: true,
      state: true,
      updatedAt: true,
      template: {
        select: {
          id: true,
          name: true,
          drillType: true,
          authority: true,
          instructions: true,
          definition: true,
        },
      },
    },
  });
}

// Narrow variant for the root loader's takeover gate, which only needs
// `audience` to decide whether to redirect. Skipping the heavy `state` JSON
// column and the joined template here keeps every navigation cheap — root
// runs this on every request that isn't to the marketing host.
export async function getActiveDrillAudience(
  prisma: PrismaClient,
  orgId: string,
) {
  return prisma.drillRun.findFirst({
    where: {
      orgId,
      status: { in: ["LIVE", "PAUSED"] },
    },
    select: { audience: true },
  });
}

/**
 * Start a brand-new LIVE DrillRun for this template.
 *
 * Always creates a NEW row — each call to "Start live drill" produces a
 * separate historical record (so we keep one DrillRun per actual drill event).
 *
 * Preconditions:
 *   - Caller MUST be admin (route enforces this; not re-checked here).
 *   - Template must belong to the org (rely on tenant extension).
 *
 * Throws a 409 Response when another drill is already LIVE or PAUSED in the
 * same org (caught from the partial unique index).
 */
export async function startDrillRun(
  prisma: PrismaClient,
  orgId: string,
  templateId: string,
  initialState: RunState = emptyRunState(),
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  audience: DrillAudience = "EVERYONE",
  mode: DrillMode = "DRILL",
  ipAddress: string | null = null,
  userAgent: string | null = null,
) {
  const now = new Date();
  try {
    // Two-step write (not $transaction([...])): the run's id is generated by
    // Prisma's @default(cuid()) so the event create needs to know the id only
    // after the run row exists. The window between the two writes is small;
    // the worst case is an event row for a run that doesn't exist, which the
    // FK rejects.
    const run = await prisma.drillRun.create({
      data: {
        orgId,
        templateId,
        status: "LIVE",
        activatedAt: now,
        state: initialState as object,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
        audience,
        mode,
      },
    });
    await prisma.drillRunEvent.create({
      data: eventCreateData(
        run.id,
        { kind: "started", initialState },
        actor,
        now,
        ipAddress,
        userAgent,
      ),
    });
    return run;
  } catch (err) {
    if (isActiveDrillUniqueViolation(err)) {
      throw activeDrillConflictResponse();
    }
    throw err;
  }
}

/**
 * Pause a LIVE drill. Read-only freeze for non-admins.
 *
 * Preconditions:
 *   - run.orgId === orgId
 *   - run.status === "LIVE"
 *
 * Returns the updated run. Throws a 404 Response if the run is missing or
 * belongs to another org; throws a 409 Response if the run is not LIVE.
 */
export async function pauseDrillRun(
  prisma: PrismaClient,
  orgId: string,
  runId: string,
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  ipAddress: string | null = null,
  userAgent: string | null = null,
) {
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true },
  });
  if (!run) {
    throw new Response("Drill run not found.", { status: 404 });
  }
  if (run.status !== "LIVE") {
    throw new Response(`Cannot pause a drill that is ${run.status}.`, {
      status: 409,
    });
  }
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.drillRun.update({
      where: { id: runId },
      data: {
        status: "PAUSED",
        pausedAt: now,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
      },
    }),
    prisma.drillRunEvent.create({
      data: eventCreateData(
        runId,
        { kind: "paused" },
        actor,
        now,
        ipAddress,
        userAgent,
      ),
    }),
  ]);
  return updated;
}

/**
 * Resume a PAUSED drill back to LIVE.
 *
 * Preconditions:
 *   - run.orgId === orgId
 *   - run.status === "PAUSED"
 *
 * Returns the updated run. Throws 404/409 in the same shape as pauseDrillRun.
 */
export async function resumeDrillRun(
  prisma: PrismaClient,
  orgId: string,
  runId: string,
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  ipAddress: string | null = null,
  userAgent: string | null = null,
) {
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true },
  });
  if (!run) {
    throw new Response("Drill run not found.", { status: 404 });
  }
  if (run.status !== "PAUSED") {
    throw new Response(`Cannot resume a drill that is ${run.status}.`, {
      status: 409,
    });
  }
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.drillRun.update({
      where: { id: runId },
      data: {
        status: "LIVE",
        pausedAt: null,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
      },
    }),
    prisma.drillRunEvent.create({
      data: eventCreateData(
        runId,
        { kind: "resumed" },
        actor,
        now,
        ipAddress,
        userAgent,
      ),
    }),
  ]);
  return updated;
}

/**
 * End a drill from either LIVE or PAUSED. Once ENDED the run becomes a
 * historical record and the partial unique index releases — admins can then
 * start a new drill.
 *
 * Preconditions:
 *   - run.orgId === orgId
 *   - run.status in {LIVE, PAUSED}
 */
export async function endDrillRun(
  prisma: PrismaClient,
  orgId: string,
  runId: string,
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  ipAddress: string | null = null,
  userAgent: string | null = null,
) {
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true },
  });
  if (!run) {
    throw new Response("Drill run not found.", { status: 404 });
  }
  if (run.status !== "LIVE" && run.status !== "PAUSED") {
    throw new Response(`Cannot end a drill that is ${run.status}.`, {
      status: 409,
    });
  }
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.drillRun.update({
      where: { id: runId },
      data: {
        status: "ENDED",
        endedAt: now,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
      },
    }),
    prisma.drillRunEvent.create({
      data: eventCreateData(
        runId,
        { kind: "ended" },
        actor,
        now,
        ipAddress,
        userAgent,
      ),
    }),
  ]);
  return updated;
}

/**
 * Result of an `updateLiveRunState` call: the updated run row plus the
 * DrillRunEvent rows just inserted for this delta. `events` is `[]` for
 * no-op saves (e.g., a teacher blurs notes without changing them) — the
 * run row is still touched so `lastActor*` / `updatedAt` advance.
 *
 * Callers (currently the live-drill action; soon the WS broadcaster) can
 * fan the events out to subscribers without a follow-up DB read.
 */
export interface UpdateLiveRunStateResult {
  run: DrillRun;
  events: DrillRunEvent[];
}

/**
 * Atomic state update for a LIVE drill. Rejects if status is PAUSED or
 * ENDED — paused drills are read-only by design, and ended drills are
 * immutable history.
 *
 * Preconditions:
 *   - run.orgId === orgId
 *   - run.status === "LIVE"
 *
 * Returns `{ run, events }`: the updated run row plus any DrillRunEvent
 * rows written for this delta (empty array for no-op saves). Throws 404
 * (missing/cross-org) or 409 (wrong status).
 */
export async function updateLiveRunState(
  prisma: PrismaClient,
  orgId: string,
  runId: string,
  state: RunState,
  actor: ActorIds = { actorUserId: null, onBehalfOfUserId: null },
  ipAddress: string | null = null,
  userAgent: string | null = null,
): Promise<UpdateLiveRunStateResult> {
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true, state: true },
  });
  if (!run) {
    throw new Response("Drill run not found.", { status: 404 });
  }
  if (run.status !== "LIVE") {
    throw new Response(
      run.status === "PAUSED"
        ? "Drill is paused — wait for an admin to resume."
        : `Cannot update a drill that is ${run.status}.`,
      { status: 409 },
    );
  }
  const prevState = parseRunState(run.state);
  const deltas = diffRunStates(prevState, state);
  const now = new Date();
  const updateOp = prisma.drillRun.update({
    where: { id: runId },
    data: {
      state: state as object,
      lastActorUserId: actor.actorUserId,
      lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
    },
  });
  if (deltas.length === 0) {
    // No-op state save (e.g., teacher blurs notes without changes). Still
    // refresh `lastActor*` / `updatedAt`, but skip the event insert.
    return { run: await updateOp, events: [] };
  }
  // Prisma's `$transaction([...])` returns results in the same order as the
  // ops, so the first slot is the updated run and the remaining slots are
  // the inserted DrillRunEvent rows — one per delta payload, in order.
  // Heterogeneous-array $transaction widens to a union; cast by position.
  const results = (await prisma.$transaction([
    updateOp,
    ...deltas.map((payload) =>
      prisma.drillRunEvent.create({
        data: eventCreateData(
          runId,
          payload,
          actor,
          now,
          ipAddress,
          userAgent,
        ),
      }),
    ),
  ])) as [DrillRun, ...DrillRunEvent[]];
  const [updatedRun, ...createdEvents] = results;
  return { run: updatedRun, events: createdEvents };
}
