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
    spaceNumber: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
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
