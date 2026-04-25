import type { Route } from "./+types/auth";
import { getAuth } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";
import { isPlatformAdmin } from "~/domain/utils/host.server";

/**
 * Better-auth's admin plugin authorizes `/api/auth/admin/impersonate-user`
 * by role alone (ADMIN / PLATFORM_ADMIN). It has no concept of tenants,
 * so a tenant ADMIN in org A could in principle impersonate a user in
 * org B if they ever obtained the target user's id.
 *
 * Policy decided 2026-04-24:
 *   - Platform admins (role PLATFORM_ADMIN or email listed in
 *     PLATFORM_ADMIN_EMAILS) can impersonate anyone, anywhere — that's
 *     the staff use case.
 *   - Everyone else can only impersonate users in their own org.
 *
 * We enforce this in front of better-auth so the plugin never even sees
 * a cross-tenant impersonation attempt. Failures return 403 with a body
 * shape that mirrors better-auth's own error responses, so the client
 * UX is consistent.
 */
const IMPERSONATE_PATH = "/api/auth/admin/impersonate-user";

async function gateImpersonateOrPassThrough(
  request: Request,
  context: any,
): Promise<Response | null> {
  // Preserve the body for the eventual better-auth handler call. We read
  // a clone for our own check and pass the original request through.
  const body = await request.clone().json().catch(() => null);
  const targetUserId =
    body && typeof body === "object" && "userId" in body
      ? String((body as Record<string, unknown>).userId ?? "")
      : "";
  if (!targetUserId) {
    // Let better-auth surface its own validation error.
    return null;
  }

  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  const actor = session?.user;
  if (!actor) {
    return new Response(
      JSON.stringify({ message: "Not authenticated", code: "UNAUTHENTICATED" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // Staff bypass — platform admins can impersonate across tenants.
  if (isPlatformAdmin({ email: actor.email, role: actor.role ?? "" }, context)) {
    return null;
  }

  const prisma = getPrisma(context);
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, orgId: true },
  });
  if (!target) {
    // Don't leak whether the id exists in another tenant.
    return new Response(
      JSON.stringify({ message: "User not found in this org.", code: "FORBIDDEN" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Compare the target's org to the actor's. `actor.orgId` is on the
  // session.user payload (better-auth's additionalFields surface it).
  const actorOrgId =
    typeof (actor as { orgId?: unknown }).orgId === "string"
      ? (actor as { orgId: string }).orgId
      : null;
  if (!actorOrgId || target.orgId !== actorOrgId) {
    return new Response(
      JSON.stringify({ message: "User not found in this org.", code: "FORBIDDEN" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Same org — let better-auth proceed.
  return null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = getAuth(context);
  return auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  // Only the impersonate endpoint needs the extra check; every other
  // better-auth route flows straight through the handler.
  const url = new URL(request.url);
  if (url.pathname === IMPERSONATE_PATH) {
    const blocked = await gateImpersonateOrPassThrough(request, context);
    if (blocked) return blocked;
  }
  const auth = getAuth(context);
  return auth.handler(request);
}
