// Worker-to-worker: BingoBoardDO's alarm POSTs a presence snapshot here
// every 30s while a drill is LIVE. We persist a `DrillRunPresenceSample`
// row that the replay UI later reads back.
//
// **No user-facing auth.** The DO can't pass a session cookie, so this
// route uses an HMAC over `(secret, runId, timestamp)` instead. Both the DO
// and this route read the secret from `env.PRESENCE_SAMPLE_HMAC_SECRET`
// (set via `wrangler secret put`). On HMAC or skew failure we return 401 —
// the caller is the DO, not a human, so we don't bother with a flash
// message. On success we return 204 (no body).
//
// This route is intentionally NOT mounted on the marketing-host gate or
// behind any session middleware: the DO calls it on whatever
// PUBLIC_ROOT_DOMAIN we resolved (so tenant subdomains are fine too — the
// DO is keyed per-org but the row goes through Prisma which is tenant-
// agnostic for this write).

import type { Route } from "./+types/drill-runs.$runId.presence-sample";
import { getPrisma } from "~/db.server";
import {
  verifyPresenceSample,
  type PresenceSampleSig,
} from "~/domain/drills/presence-sample-hmac";

type ViewerEntry = {
  userId: string;
  label: string;
  onBehalfOfUserId: string | null;
  onBehalfOfLabel: string | null;
  color: string;
};

type PresenceSamplePayload = {
  viewers: ViewerEntry[];
  guestCount: number;
  timestamp: string;
  hmac: string;
};

function isViewerEntry(v: unknown): v is ViewerEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.userId === "string" &&
    typeof o.label === "string" &&
    (o.onBehalfOfUserId === null || typeof o.onBehalfOfUserId === "string") &&
    (o.onBehalfOfLabel === null || typeof o.onBehalfOfLabel === "string") &&
    typeof o.color === "string"
  );
}

function parsePayload(raw: unknown): PresenceSamplePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.viewers)) return null;
  if (!o.viewers.every(isViewerEntry)) return null;
  if (typeof o.guestCount !== "number" || !Number.isFinite(o.guestCount))
    return null;
  if (o.guestCount < 0) return null;
  if (typeof o.timestamp !== "string") return null;
  if (typeof o.hmac !== "string") return null;
  return {
    viewers: o.viewers,
    guestCount: o.guestCount,
    timestamp: o.timestamp,
    hmac: o.hmac,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const runId = params.runId;
  if (!runId) {
    return new Response("Missing runId", { status: 400 });
  }

  const env = (context as any)?.cloudflare?.env as Env | undefined;
  const secret = env?.PRESENCE_SAMPLE_HMAC_SECRET ?? "";
  if (!secret) {
    // No secret configured — refuse to write rather than accept anonymous
    // POSTs. Worker secret is documented in env.d.ts.
    return new Response("Not configured", { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const payload = parsePayload(raw);
  if (!payload) {
    return new Response("Invalid payload", { status: 400 });
  }

  const sig: PresenceSampleSig = {
    hmac: payload.hmac,
    timestamp: payload.timestamp,
  };
  const verified = await verifyPresenceSample(secret, runId, sig);
  if (!verified.ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  const prisma = getPrisma(context);

  // Strip down what we persist: the DO sends `userId`, `label`,
  // `onBehalfOfUserId`, `onBehalfOfLabel`, `color`. The schema comment
  // documents an `isGuest` field too — we set it to `false` for stored
  // rows since this endpoint only ingests authed viewers (guests are
  // collapsed into `guestCount` at the DO).
  const viewersForRow = payload.viewers.map((v) => ({
    userId: v.userId,
    label: v.label,
    onBehalfOfUserId: v.onBehalfOfUserId,
    onBehalfOfLabel: v.onBehalfOfLabel,
    isGuest: false,
    color: v.color,
  }));

  try {
    await prisma.drillRunPresenceSample.create({
      data: {
        runId,
        // Use the DO-supplied timestamp (the value we HMAC'd) as the
        // canonical occurredAt so a slow round-trip doesn't bunch
        // multiple samples at the server clock.
        occurredAt: new Date(payload.timestamp),
        viewers: viewersForRow,
        guestCount: payload.guestCount,
      },
    });
  } catch (err) {
    // FK violation when runId doesn't match an existing DrillRun is the
    // most common case (e.g. test artifact runs that were deleted). Log
    // and 404 so the DO knows to stop sending.
    console.error("presence-sample.create failed", { runId }, err);
    return new Response("Could not write sample", { status: 404 });
  }

  return new Response(null, { status: 204 });
}
