import { groupAttachmentsByRun } from "../app/domain/drills/presence-sample-aggregate";
import { signPresenceSample } from "../app/domain/drills/presence-sample-hmac";

// 30s cadence for the presence-snapshot alarm. Matches the user-visible
// "writes ~120 rows for an hour-long drill" target in the design doc and
// also keeps the alarm chain cheap (one DO write + one fetch per tick).
const PRESENCE_SAMPLE_INTERVAL_MS = 30_000;

// What we serializeAttachment() onto each WebSocket on every `drillPresence`
// message. The hibernation API persists this verbatim, so a DO restart can
// reconstruct the roster for the snapshot without needing a memory map.
//
// Must stay structurally compatible with `SocketAttachment` in
// `app/domain/drills/presence-sample-aggregate.ts` — that helper consumes
// these objects to build the snapshot rows.
type DrillPresenceAttachment = {
  runId: string;
  userId: string;
  label: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfLabel: string | null;
  isGuest: boolean;
  color: string;
  at: number;
};

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
      // Drill lifecycle / activity / presence broadcasts are the signal
      // that a run is LIVE on this DO — arm the snapshot alarm. We don't
      // disarm on `drillEnded`; the alarm() handler itself will let the
      // chain die when getWebSockets() returns nothing useful (no LIVE
      // sockets → no rows posted → no re-arm).
      if (
        data &&
        typeof data === "object" &&
        typeof (data as { type?: unknown }).type === "string"
      ) {
        const t = (data as { type: string }).type;
        if (
          t === "drillUpdate" ||
          t === "drillActivity" ||
          t === "drillPresence"
        ) {
          await this.armPresenceSampleAlarm();
        }
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
    // Capture per-socket identity for the snapshot alarm BEFORE the relay
    // block runs. We deliberately parse the message twice (once here, once
    // inside the relay block) so the relay block stays untouched — it's
    // the load-bearing path everyone else depends on.
    this.tryUpdateAttachment(_ws, message);
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

  // ---- presence snapshot (W4): per-WS attachment + 30s alarm + POST ------

  /**
   * Parse `message` and, if it's a `drillPresence` envelope, refresh this
   * socket's `serializeAttachment(...)` so a hibernation restart still has
   * the identity needed to assemble a snapshot. Also (best-effort) arms the
   * alarm — this is the only path a viewer-pin guest takes (they never
   * trigger a `/broadcast` from the server), so without this hook a
   * guests-only run wouldn't ever arm its alarm.
   *
   * Errors are swallowed: a malformed presence message must not knock the
   * relay loop offline.
   */
  private tryUpdateAttachment(ws: WebSocket, message: string) {
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const obj = data as Record<string, unknown>;
    if (obj.type !== "drillPresence") return;
    const runId = typeof obj.runId === "string" ? obj.runId : null;
    const userId = typeof obj.userId === "string" ? obj.userId : null;
    if (!runId || !userId) return;
    const labelRaw = obj.label;
    const label =
      typeof labelRaw === "string"
        ? labelRaw
        : labelRaw === null
          ? null
          : null;
    const onBehalfOfUserId =
      typeof obj.onBehalfOfUserId === "string" ? obj.onBehalfOfUserId : null;
    const onBehalfOfLabel =
      typeof obj.onBehalfOfLabel === "string" ? obj.onBehalfOfLabel : null;
    const color =
      typeof obj.color === "string" && obj.color.length > 0
        ? obj.color
        : "hsl(0 0% 50%)";
    const attachment: DrillPresenceAttachment = {
      runId,
      userId,
      // A null label is the marker for a viewer-pin guest. Authed users
      // always send a (non-empty) label string; we collapse "" to null so
      // the snapshot grouping treats a malformed authed message as a guest
      // rather than a labelless authed entry.
      label: label && label.length > 0 ? label : null,
      onBehalfOfUserId,
      onBehalfOfLabel,
      isGuest: !(label && label.length > 0),
      color,
      at: Date.now(),
    };
    try {
      ws.serializeAttachment(attachment);
    } catch {
      // serializeAttachment can throw if the value isn't structuredClone-
      // able. Our shape is plain JSON, so this should never fire — guard
      // anyway so a bad attachment doesn't kill the message handler.
      return;
    }
    // Best-effort alarm rearm. We don't block the relay on this.
    void this.armPresenceSampleAlarm();
  }

  /**
   * Set the snapshot alarm if one isn't already scheduled.
   *
   * Cloudflare Workers gives us a single alarm timer per DO. `getAlarm()`
   * returns the currently-scheduled time (or null) — we only call
   * `setAlarm()` when there's nothing pending so a flurry of presence
   * heartbeats don't keep stomping the alarm and effectively delaying it
   * indefinitely.
   */
  private async armPresenceSampleAlarm() {
    try {
      const existing = await this.state.storage.getAlarm();
      if (existing !== null && existing !== undefined) return;
      await this.state.storage.setAlarm(
        Date.now() + PRESENCE_SAMPLE_INTERVAL_MS,
      );
    } catch {
      // Ignore: alarm storage failure shouldn't break presence relay.
    }
  }

  /**
   * Snapshot tick. Fires every 30s while a run is LIVE and at least one
   * socket is connected. Body:
   *
   *   1. Read every socket's attachment.
   *   2. Group attachments by `runId` (one drill per row).
   *   3. POST `{ viewers, guestCount, timestamp, hmac }` to the
   *      worker-to-worker `/api/drill-runs/:runId/presence-sample` route.
   *   4. Re-arm the alarm if any socket remains.
   *
   * A failed POST is logged and swallowed — alarm() must NEVER throw, or
   * Cloudflare aborts the alarm chain and we lose every subsequent sample.
   */
  async alarm() {
    let snapshots: ReturnType<typeof this.collectSnapshots> = [];
    try {
      snapshots = this.collectSnapshots();
    } catch (err) {
      console.error("BingoBoardDO.alarm: collectSnapshots failed", err);
    }

    const baseUrl = this.resolvePresenceSampleBaseUrl();
    const secret = this.env.PRESENCE_SAMPLE_HMAC_SECRET ?? "";

    if (baseUrl && secret) {
      for (const snap of snapshots) {
        try {
          await this.postPresenceSample(baseUrl, secret, snap);
        } catch (err) {
          console.error(
            "BingoBoardDO.alarm: presence-sample POST failed",
            { runId: snap.runId },
            err,
          );
          // Continue: one runId's failure must not abort sibling runs.
        }
      }
    }

    // Re-arm only if there's still someone on the wire. Otherwise let the
    // chain end so a quiet DO doesn't keep poking storage.
    try {
      const sockets = this.state.getWebSockets();
      if (sockets.length > 0) {
        await this.state.storage.setAlarm(
          Date.now() + PRESENCE_SAMPLE_INTERVAL_MS,
        );
      }
    } catch (err) {
      console.error("BingoBoardDO.alarm: re-arm failed", err);
    }
  }

  private collectSnapshots(): Array<{
    runId: string;
    authedViewers: Array<{
      userId: string;
      label: string;
      onBehalfOfUserId: string | null;
      onBehalfOfLabel: string | null;
      color: string;
    }>;
    guestCount: number;
  }> {
    const attachments: DrillPresenceAttachment[] = [];
    for (const ws of this.state.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() as
          | DrillPresenceAttachment
          | null
          | undefined;
        if (a && typeof a === "object" && typeof a.runId === "string") {
          attachments.push(a);
        }
      } catch {
        // Ignore: a socket without an attachment is just one that hasn't
        // sent a drillPresence message yet.
      }
    }
    return groupAttachmentsByRun(attachments);
  }

  private resolvePresenceSampleBaseUrl(): string | null {
    // Self-loopback origin for the alarm POST. We reuse PUBLIC_ROOT_DOMAIN
    // (already configured for every env in wrangler.jsonc) and the
    // ENVIRONMENT var to decide between http (dev/localhost) and https
    // (everywhere else). This avoids having to introduce yet another env
    // var; if a future env ever needs a fully custom base URL, we can
    // promote `PRESENCE_SAMPLE_BASE_URL` and have it take precedence.
    const root = (this.env.PUBLIC_ROOT_DOMAIN ?? "").trim();
    if (!root) return null;
    const isLocal =
      root === "localhost" ||
      root === "127.0.0.1" ||
      root.endsWith(".localhost");
    const scheme = isLocal ? "http" : "https";
    return `${scheme}://${root}`;
  }

  private async postPresenceSample(
    baseUrl: string,
    secret: string,
    snapshot: {
      runId: string;
      authedViewers: Array<{
        userId: string;
        label: string;
        onBehalfOfUserId: string | null;
        onBehalfOfLabel: string | null;
        color: string;
      }>;
      guestCount: number;
    },
  ) {
    const timestamp = new Date().toISOString();
    const hmac = await signPresenceSample(secret, snapshot.runId, timestamp);
    const url = `${baseUrl}/api/drill-runs/${encodeURIComponent(snapshot.runId)}/presence-sample`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewers: snapshot.authedViewers,
        guestCount: snapshot.guestCount,
        timestamp,
        hmac,
      }),
    });
    if (!res.ok) {
      // Drain the body so the connection can be reused, but swallow the
      // text — the status alone is the diagnostic.
      try {
        await res.text();
      } catch {
        // ignore
      }
      console.error(
        "BingoBoardDO.alarm: presence-sample non-OK",
        { runId: snapshot.runId, status: res.status },
      );
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
