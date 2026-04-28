import type { Route } from "./+types/update.$space";
import { redirect } from "react-router";
import { assertTrialAllowsNewPickup } from "~/domain/billing/trial-enforcement.server";
import { getOptionalUserFromContext, getOrgFromContext } from "~/domain/utils/global-context.server";
import { getAuditContextFromRequest } from "~/domain/auth/audit-context.server";

export async function action({ params, request, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  // Spot-call is privileged: only signed-in CONTROLLER users (or someone
  // impersonating a controller via better-auth) may record dismissals.
  // ADMINs are intentionally excluded — managing the roster ≠ running it.
  // Throws 401/403 (Response, not redirect) so the fetcher submission
  // surfaces a real failure rather than a silent UI bounce.
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Not authenticated", { status: 401 });
  if (user.role !== "CONTROLLER") throw new Response("Forbidden", { status: 403 });

  // Tenant routes always have an org (set by globalStorageMiddleware via
  // host resolution). Required strictly here because we route to a
  // per-tenant Durable Object below — no org → no DO target, and
  // silently falling back to a shared singleton would leak realtime
  // broadcasts across tenants.
  const org = getOrgFromContext(context);

  // Enforce trial expiration for FREE orgs before recording a pickup event.
  await assertTrialAllowsNewPickup(context, org.id);

  const spaceNumber = parseInt(space);
  const timestamp = new Date().toISOString();
  const env = (context as any).cloudflare.env;

  // Forensic context: actor pair plus IP + user-agent. The DO writes the
  // CallEvent row from raw SQL and embeds these columns directly so the
  // audit trail is complete without a follow-up update.
  const { actor, ipAddress, userAgent } = getAuditContextFromRequest(
    request,
    context,
  );
  const { actorUserId, onBehalfOfUserId } = actor;

  // Per-tenant Durable Object: each org gets its own isolate keyed by orgId,
  // so WebSocket broadcasts and hibernated sessions stay scoped to that
  // tenant. CF DOs are lazily materialized — no signup-time provisioning
  // needed; the first .fetch() against a new orgId brings the DO into
  // existence.
  const id = env.BINGO_BOARD.idFromName(org.id);
  const stub = env.BINGO_BOARD.get(id);
  // Forward the tenant's orgId so the DO's raw D1 writes (CallEvent INSERT,
  // Space UPDATE, Student SELECT) scope to this tenant rather than the
  // column-default 'org_tome'. Without this, /admin/history for any
  // non-`org_tome` tenant never sees its own dismissal events.
  await stub.fetch("https://internal/space-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "ACTIVE",
      spaceNumber,
      timestamp,
      orgId: org.id,
      actorUserId,
      onBehalfOfUserId,
      ipAddress,
      userAgent,
    }),
  });

  return new Response("OK");
}
