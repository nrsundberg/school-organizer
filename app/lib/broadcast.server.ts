export async function broadcastSpaceUpdate(
  env: Env,
  spaceNumber: number,
  status: string,
  timestamp?: string | null,
) {
  const id = env.BINGO_BOARD.idFromName("main");
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spaceUpdate", spaceNumber, status, timestamp }),
  });
}

export async function broadcastBoardReset(env: Env) {
  const id = env.BINGO_BOARD.idFromName("main");
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "boardReset" }),
  });
}

export async function broadcastCallEvent(
  env: Env,
  event: {
    id: number;
    spaceNumber: number;
    studentId: number | null;
    studentName: string;
    homeRoomSnapshot: string | null;
    createdAt: Date;
  },
) {
  const id = env.BINGO_BOARD.idFromName("main");
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
