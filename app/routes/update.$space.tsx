import type { Route } from "./+types/update.$space";
import { redirect } from "react-router";
import { assertTrialAllowsNewPickup } from "~/domain/billing/trial-enforcement.server";
import { getOrgFromContext } from "~/domain/utils/global-context.server";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

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
    body: JSON.stringify({ type: "ACTIVE", spaceNumber, timestamp, orgId: org.id }),
  });

  return new Response("OK");
}
