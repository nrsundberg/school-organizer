import { data } from "react-router";
import type { Route } from "./+types/status-probe";
import { COMPONENTS } from "~/domain/status/components";
import { recordProbeResult } from "~/domain/status/runner.server";
import type { ComponentId, ComponentStatus, ProbeResult } from "~/domain/status/types";

const VALID_STATUS: ReadonlySet<ComponentStatus> = new Set([
  "operational",
  "degraded",
  "outage",
  "unknown",
]);
const VALID_COMPONENT_IDS = new Set<ComponentId>(
  COMPONENTS.map((c) => c.id),
);

type ProbeBody = {
  componentId?: unknown;
  status?: unknown;
  latencyMs?: unknown;
  detail?: unknown;
};

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const env = (context as any)?.cloudflare?.env as
    | { STATUS_PROBE_SECRET?: string }
    | undefined;
  const expected = env?.STATUS_PROBE_SECRET;
  if (!expected) {
    // Misconfigured deploy — fail closed rather than accept anonymous writes.
    return data({ error: "Status probe disabled" }, { status: 503 });
  }
  const provided = request.headers.get("x-status-probe-secret") ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProbeBody;
  try {
    body = (await request.json()) as ProbeBody;
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 });
  }

  const componentId = String(body.componentId ?? "");
  if (!VALID_COMPONENT_IDS.has(componentId as ComponentId)) {
    return data(
      { error: `Unknown componentId: ${componentId}` },
      { status: 400 },
    );
  }
  const status = String(body.status ?? "");
  if (!VALID_STATUS.has(status as ComponentStatus)) {
    return data({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const latencyMs =
    typeof body.latencyMs === "number" && Number.isFinite(body.latencyMs)
      ? Math.max(0, Math.round(body.latencyMs))
      : null;
  const detail =
    typeof body.detail === "string" ? body.detail.slice(0, 500) : null;

  const result: ProbeResult = {
    componentId: componentId as ComponentId,
    status: status as ComponentStatus,
    latencyMs,
    detail,
  };
  const change = await recordProbeResult(context, result);
  return data({ ok: true, componentId, status, change });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
