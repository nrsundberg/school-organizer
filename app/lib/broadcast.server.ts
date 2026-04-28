/**
 * All broadcast helpers route through the per-tenant `BINGO_BOARD` Durable
 * Object — keyed by `orgId` so each tenant gets an isolated WebSocket
 * fan-out. Callers must pass the resolved tenant orgId (typically from
 * `getOrgFromContext`).
 */
export async function broadcastSpaceUpdate(
  env: Env,
  orgId: string,
  spaceNumber: number,
  status: string,
  timestamp?: string | null,
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spaceUpdate", spaceNumber, status, timestamp }),
  });
}

export async function broadcastBoardReset(env: Env, orgId: string) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "boardReset" }),
  });
}

export async function broadcastCallEvent(
  env: Env,
  orgId: string,
  event: {
    id: number;
    orgId: string;
    spaceNumber: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
    actorUserId: string | null;
    onBehalfOfUserId: string | null;
    /** Forensic network context. Both nullable; legacy rows / unset header. */
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  },
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "callEvent",
      event: {
        ...event,
        createdAt: event.createdAt.toISOString(),
      },
    }),
  });
}

export async function broadcastProgramCancellation(
  env: Env,
  cancellation: {
    id: string;
    programName: string;
    cancellationDate: string;
    title: string;
    message: string;
  },
) {
  const id = env.BINGO_BOARD.idFromName("main");
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "programCancellation",
      cancellation,
    }),
  });
}

export async function broadcastDrillUpdate(
  env: Env,
  orgId: string,
  run: {
    id: string;
    status: "LIVE" | "PAUSED" | "ENDED";
    audience: string;
    state: unknown;
    updatedAtIso: string;
  },
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "drillUpdate", run }),
  });
}

export async function broadcastDrillActivity(
  env: Env,
  orgId: string,
  runId: string,
  events: Array<{
    id: string;
    runId: string;
    kind: string;
    payload: unknown;
    actorUserId: string | null;
    actorLabel: string | null;
    onBehalfOfUserId: string | null;
    onBehalfOfLabel: string | null;
    occurredAtIso: string;
  }>,
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "drillActivity", runId, events }),
  });
}

export async function broadcastDrillPresence(
  env: Env,
  orgId: string,
  payload: {
    runId: string;
    userId: string;
    label: string;
    onBehalfOfUserId: string | null;
    onBehalfOfLabel: string | null;
    color: string;
    focus:
      | { kind: "notes" }
      | { kind: "item"; id: string }
      | null;
    at: string;
  },
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "drillPresence", ...payload }),
  });
}

export async function broadcastDrillEnded(
  env: Env,
  orgId: string,
  runId: string,
) {
  const id = env.BINGO_BOARD.idFromName(orgId);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "drillEnded", runId }),
  });
}
