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
      const body = await request.json() as {
        type: "ACTIVE" | "EMPTY";
        spaceNumber: number;
        timestamp?: string;
        /**
         * Tenant orgId for multi-tenant scoping. Callers (`app/routes/update.$space.tsx`
         * and `app/routes/empty.$space.tsx`) pull this from `getOrgFromContext` and
         * pass it through. Without it, raw D1 writes fall through to the column
         * default ("org_tome") and `/admin/history` for any non-`org_tome` tenant
         * never sees its own dismissal events.
         *
         * Optional only as a transitional safety net: when `orgId` is missing we
         * keep the previous (broken-for-multi-tenant) behavior rather than 400ing
         * — there is no realistic caller that should ever omit it. If you're
         * adding a new caller, pass `orgId`.
         */
        orgId?: string;
        /**
         * Audit pair. Both null on anonymous viewer clicks; both non-null
         * when an admin is impersonating; otherwise actorUserId is the
         * authenticated user's id and onBehalfOfUserId is null.
         */
        actorUserId?: string | null;
        onBehalfOfUserId?: string | null;
        /**
         * Forensic network context captured at the route boundary via
         * `getAuditContextFromRequest`. Stored verbatim on the CallEvent row;
         * D1's at-rest encryption is the privacy bar. Both nullable for
         * legacy callers / unreachable headers.
         */
        ipAddress?: string | null;
        userAgent?: string | null;
      };
      const {
        type,
        spaceNumber,
        timestamp,
        orgId,
        actorUserId,
        onBehalfOfUserId,
        ipAddress,
        userAgent,
      } = body;
      const db = this.env.D1_DATABASE;

      if (type === "ACTIVE") {
        const ts = timestamp ?? new Date().toISOString();
        if (orgId) {
          await db
            .prepare(`UPDATE "Space" SET status='ACTIVE', timestamp=? WHERE spaceNumber=? AND orgId=?`)
            .bind(ts, spaceNumber, orgId)
            .run();
        } else {
          await db
            .prepare(`UPDATE "Space" SET status='ACTIVE', timestamp=? WHERE spaceNumber=?`)
            .bind(ts, spaceNumber)
            .run();
        }

        const student = orgId
          ? await db
              .prepare(
                `SELECT id, firstName, lastName, homeRoom FROM "Student" WHERE spaceNumber=? AND orgId=? LIMIT 1`
              )
              .bind(spaceNumber, orgId)
              .first<{ id: number; firstName: string; lastName: string; homeRoom: string | null }>()
          : await db
              .prepare(
                `SELECT id, firstName, lastName, homeRoom FROM "Student" WHERE spaceNumber=? LIMIT 1`
              )
              .bind(spaceNumber)
              .first<{ id: number; firstName: string; lastName: string; homeRoom: string | null }>();

        const studentName = student ? `${student.firstName} ${student.lastName}` : `Space ${spaceNumber}`;
        // The CallEvent INSERT must include orgId explicitly: the column has a
        // NOT NULL DEFAULT 'org_tome' (see migrations/0005z_org_multitenant.sql),
        // so omitting it silently writes every tenant's events under the
        // platform-default org. That's the bug `/admin/history` for e2e-seeded
        // tenants hit (see docs/nightly/2026-04-24-0d1-dismissal-build.md §1).
        const result = orgId
          ? await db
              .prepare(
                `INSERT INTO "CallEvent" (orgId, spaceNumber, studentId, studentName, homeRoomSnapshot, actorUserId, onBehalfOfUserId, ipAddress, userAgent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING id, orgId, spaceNumber, studentId, studentName, homeRoomSnapshot, actorUserId, onBehalfOfUserId, ipAddress, userAgent, createdAt`
              )
              .bind(
                orgId,
                spaceNumber,
                student?.id ?? null,
                studentName,
                student?.homeRoom ?? null,
                actorUserId ?? null,
                onBehalfOfUserId ?? null,
                ipAddress ?? null,
                userAgent ?? null,
              )
              .first<{
                id: number;
                orgId: string;
                spaceNumber: number;
                studentId: number | null;
                studentName: string;
                homeRoomSnapshot: string | null;
                actorUserId: string | null;
                onBehalfOfUserId: string | null;
                ipAddress: string | null;
                userAgent: string | null;
                createdAt: string;
              }>()
          : await db
              .prepare(
                `INSERT INTO "CallEvent" (spaceNumber, studentId, studentName, homeRoomSnapshot, actorUserId, onBehalfOfUserId, ipAddress, userAgent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING id, orgId, spaceNumber, studentId, studentName, homeRoomSnapshot, actorUserId, onBehalfOfUserId, ipAddress, userAgent, createdAt`
              )
              .bind(
                spaceNumber,
                student?.id ?? null,
                studentName,
                student?.homeRoom ?? null,
                actorUserId ?? null,
                onBehalfOfUserId ?? null,
                ipAddress ?? null,
                userAgent ?? null,
              )
              .first<{
                id: number;
                orgId: string;
                spaceNumber: number;
                studentId: number | null;
                studentName: string;
                homeRoomSnapshot: string | null;
                actorUserId: string | null;
                onBehalfOfUserId: string | null;
                ipAddress: string | null;
                userAgent: string | null;
                createdAt: string;
              }>();

        this.broadcast(JSON.stringify({ type: "spaceUpdate", spaceNumber, status: "ACTIVE", timestamp: ts }));
        if (result) {
          this.broadcast(JSON.stringify({ type: "callEvent", event: { ...result, createdAt: result.createdAt } }));
        }
      } else {
        if (orgId) {
          await db
            .prepare(`UPDATE "Space" SET status='EMPTY', timestamp=NULL WHERE spaceNumber=? AND orgId=?`)
            .bind(spaceNumber, orgId)
            .run();
        } else {
          await db
            .prepare(`UPDATE "Space" SET status='EMPTY', timestamp=NULL WHERE spaceNumber=?`)
            .bind(spaceNumber)
            .run();
        }
        this.broadcast(JSON.stringify({ type: "spaceUpdate", spaceNumber, status: "EMPTY", timestamp: null }));
      }

      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    if (message === "ping") {
      _ws.send("pong");
      return;
    }
    // Relay client-originated drill presence messages to all connected
    // sockets in this org's DO. Presence is ephemeral ("X is editing
    // notes") with no DB write — fanning it out through the DO avoids a
    // round-trip to the worker action route per heartbeat. The DO is
    // already keyed per-org so the relay scope is correct; we explicitly
    // gate on `type === "drillPresence"` so this can't be used as a
    // general client-to-client relay.
    try {
      const data = JSON.parse(message);
      if (data && typeof data === "object" && data.type === "drillPresence") {
        this.broadcast(message);
      }
    } catch {
      // Ignore malformed payloads.
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
