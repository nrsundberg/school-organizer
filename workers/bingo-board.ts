export class BingoBoardDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.getWebSockets().forEach(() => {
      // Sessions are automatically restored via hibernation API
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const data = await request.json();
      this.broadcast(JSON.stringify(data));
      return new Response("OK");
    }

    if (url.pathname === "/space-update" && request.method === "POST") {
      const body = await request.json() as { type: "ACTIVE" | "EMPTY"; spaceNumber: number; timestamp?: string };
      const { type, spaceNumber, timestamp } = body;
      const db = this.env.D1_DATABASE;

      if (type === "ACTIVE") {
        const ts = timestamp ?? new Date().toISOString();
        await db.prepare(`UPDATE "Space" SET status='ACTIVE', timestamp=? WHERE spaceNumber=?`).bind(ts, spaceNumber).run();

        const student = await db.prepare(
          `SELECT id, firstName, lastName, homeRoom FROM "Student" WHERE spaceNumber=? LIMIT 1`
        ).bind(spaceNumber).first<{ id: number; firstName: string; lastName: string; homeRoom: string | null }>();

        const studentName = student ? `${student.firstName} ${student.lastName}` : `Space ${spaceNumber}`;
        const result = await db.prepare(
          `INSERT INTO "CallEvent" (spaceNumber, studentId, studentName, homeRoomSnapshot, createdAt) VALUES (?, ?, ?, ?, datetime('now')) RETURNING id, spaceNumber, studentId, studentName, homeRoomSnapshot, createdAt`
        ).bind(spaceNumber, student?.id ?? null, studentName, student?.homeRoom ?? null).first<{ id: number; spaceNumber: number; studentId: number | null; studentName: string; homeRoomSnapshot: string | null; createdAt: string }>();

        this.broadcast(JSON.stringify({ type: "spaceUpdate", spaceNumber, status: "ACTIVE", timestamp: ts }));
        if (result) {
          this.broadcast(JSON.stringify({ type: "callEvent", event: { ...result, createdAt: result.createdAt } }));
        }
      } else {
        await db.prepare(`UPDATE "Space" SET status='EMPTY', timestamp=NULL WHERE spaceNumber=?`).bind(spaceNumber).run();
        this.broadcast(JSON.stringify({ type: "spaceUpdate", spaceNumber, status: "EMPTY", timestamp: null }));
      }

      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") {
      _ws.send("pong");
    }
  }

  webSocketClose(ws: WebSocket) {
    ws.close();
  }

  webSocketError(ws: WebSocket) {
    ws.close();
  }

  private broadcast(message: string) {
    const sessions = this.state.getWebSockets();
    for (const ws of sessions) {
      try {
        ws.send(message);
      } catch {
        // Session likely closed; skip
      }
    }
  }
}
