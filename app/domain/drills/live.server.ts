import type { PrismaClient } from "~/db";
import { emptyRunState, type RunState } from "./types";

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
    include: {
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
) {
  try {
    return await prisma.drillRun.create({
      data: {
        orgId,
        templateId,
        status: "LIVE",
        activatedAt: new Date(),
        state: initialState as object,
      },
    });
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
  return prisma.drillRun.update({
    where: { id: runId },
    data: {
      status: "PAUSED",
      pausedAt: new Date(),
    },
  });
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
  return prisma.drillRun.update({
    where: { id: runId },
    data: {
      status: "LIVE",
      pausedAt: null,
    },
  });
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
  return prisma.drillRun.update({
    where: { id: runId },
    data: {
      status: "ENDED",
      endedAt: new Date(),
    },
  });
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
 * Returns the updated run. Throws 404 (missing/cross-org) or 409 (wrong
 * status).
 */
export async function updateLiveRunState(
  prisma: PrismaClient,
  orgId: string,
  runId: string,
  state: RunState,
) {
  const run = await prisma.drillRun.findFirst({
    where: { id: runId, orgId },
    select: { id: true, status: true },
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
  return prisma.drillRun.update({
    where: { id: runId },
    data: { state: state as object },
  });
}
