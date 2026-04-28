/**
 * Bundle the actor + network context an action handler needs in order to
 * write a complete audit row. One call at the route boundary, then thread
 * the result down into domain code instead of re-resolving each piece.
 *
 * The `actor` field carries the (actorUserId, onBehalfOfUserId) pair —
 * `actorUserId` is the human who clicked (admin's id when impersonating),
 * `onBehalfOfUserId` is the impersonated user's id, or null. See
 * `resolveActorIds` in `impersonate-gate.server.ts`.
 *
 * `ipAddress` falls back to `null` when Cloudflare's edge headers don't
 * yield a usable value (e.g. local dev) — `clientIpFromRequest` returns
 * the literal string "unknown" in that case, which we treat as missing.
 */
import { clientIpFromRequest } from "~/domain/utils/rate-limit.server";
import { getActorIdsFromContext } from "~/domain/utils/global-context.server";
import type { ActorIds } from "~/domain/auth/impersonate-gate.server";

export type AuditContext = {
  actor: ActorIds;
  ipAddress: string | null;
  userAgent: string | null;
};

export function getAuditContextFromRequest(
  request: Request,
  context: any,
): AuditContext {
  const actor = getActorIdsFromContext(context);
  const ipRaw = clientIpFromRequest(request);
  const ipAddress = ipRaw && ipRaw !== "unknown" ? ipRaw : null;
  const userAgent = request.headers.get("user-agent");
  return { actor, ipAddress, userAgent };
}
