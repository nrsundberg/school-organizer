/**
 * Request-scope resolver.
 *
 * Owns the full decision tree run by `globalStorageMiddleware` on every
 * request: host → org, session → user, impersonation overlay, console
 * redirects, tenant ↔ org match, anonymous-viewer access, billing gate.
 *
 * The middleware itself becomes a thin coupling layer: call this resolver,
 * persist the result into legacy contexts, return next(). Routes still
 * read those legacy contexts today; future PRs can migrate route loaders
 * to consume `ResolvedRequestScope` directly.
 *
 * Each rule that can deny access throws a `redirect(...)` Response. Callers
 * never have to know the rule strings — the resolver owns the policy.
 */

import { redirect } from "react-router";
import type { Org, User } from "~/db";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import { isOrgAccessAllowed } from "~/domain/billing/org-status";
import {
  resolveActorIds,
  type ActorIds,
} from "~/domain/auth/impersonate-gate.server";
import {
  isMarketingHost,
  isPlatformAdmin,
  marketingOriginFromRequest,
  resolveTenantSlugFromHost,
} from "~/domain/utils/host.server";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import { classifyRequestPath } from "./path-classification";

export type ImpersonationState = {
  active: boolean;
  /** Effective org id when impersonating; null otherwise. Always equals `org.id` when active. */
  orgId: string | null;
  /** Better-auth's "acting as user" id, when set. */
  byUserId: string | null;
};

export type ResolvedRequestScope = {
  user: User | null;
  /** Effective org for this request — impersonated org when active, host-resolved otherwise. */
  org: Org | null;
  /** The user's home org when impersonating into a different one; null otherwise. */
  realOrg: Org | null;
  impersonation: ImpersonationState;
  actor: ActorIds;
};

export async function resolveRequestScope(
  request: Request,
  context: any,
): Promise<ResolvedRequestScope> {
  const url = new URL(request.url);
  const onMarketingHost = isMarketingHost(request, context);
  const path = classifyRequestPath(url.pathname, onMarketingHost);

  const db = getPrisma(context);

  const hostOrg = await resolveOrgByHost(db, request, context).catch(() => null);
  const session = await loadSession(db, request, context);

  // Apply impersonation overlay. Impersonation takes precedence over both
  // host-resolved and user.orgId.
  let org: Org | null = hostOrg;
  let realOrg: Org | null = null;
  if (!onMarketingHost && session.impersonatedOrgId) {
    const impOrg = await db.org.findUnique({
      where: { id: session.impersonatedOrgId },
    });
    if (impOrg) {
      org = impOrg;
      // The user's "real" org is whatever they'd be on without the overlay.
      if (session.user?.orgId && session.user.orgId !== impOrg.id) {
        realOrg = await db.org.findUnique({
          where: { id: session.user.orgId },
        });
      }
    }
  } else if (!onMarketingHost && !org && session.user?.orgId) {
    org = await db.org.findUnique({ where: { id: session.user.orgId } });
  }
  if (onMarketingHost) {
    org = null;
    realOrg = null;
  }

  const impersonation: ImpersonationState = {
    active:
      session.impersonatedOrgId != null &&
      org?.id === session.impersonatedOrgId,
    orgId: session.impersonatedOrgId,
    byUserId: session.impersonatedBy,
  };

  // mustChangePassword detour — runs early so subsequent redirects don't
  // shadow it.
  if (
    session.user?.mustChangePassword &&
    !path.isSetPassword &&
    !path.isApi &&
    !path.isLogout
  ) {
    throw redirect("/set-password");
  }

  // Console redirects: platform/district staff hitting tenant subdomains
  // without an active impersonation get bounced back to their console.
  enforceConsoleRedirects({
    request,
    context,
    path,
    user: session.user,
    org,
    onMarketingHost,
    impersonation,
  });

  // Tenant ↔ org match: a regular user on the wrong tenant gets redirected
  // to their home org's URL (or to /signup if their account has no org).
  await enforceTenantOrgMatch({
    db,
    request,
    context,
    path,
    user: session.user,
    org,
    onMarketingHost,
    impersonation,
  });

  // Anonymous-viewer access: no session, on a tenant org, must hold a valid
  // viewer-access cookie unless the path is anon-skippable.
  await enforceAnonymousAccess({
    request,
    context,
    path,
    user: session.user,
    org,
  });

  // Billing gate: authed user + org → must pass `isOrgAccessAllowed`,
  // including district-deference when the org is part of a district.
  await enforceBillingGate({
    db,
    path,
    user: session.user,
    org,
  });

  return {
    user: session.user,
    org,
    realOrg,
    impersonation,
    actor: resolveActorIds(session.user?.id ?? null, session.impersonatedBy),
  };
}

// ---------------------------------------------------------------------------
// Internals — each rule isolated for readability and (in principle) testing.
// ---------------------------------------------------------------------------

type SessionFacts = {
  user: User | null;
  impersonatedOrgId: string | null;
  impersonatedBy: string | null;
};

async function resolveOrgByHost(
  db: ReturnType<typeof getPrisma>,
  request: Request,
  context: any,
): Promise<Org | null> {
  const host = new URL(request.url).host.toLowerCase().split(":")[0];
  const byCustom = await db.org.findFirst({ where: { customDomain: host } });
  if (byCustom) return byCustom;

  if (isMarketingHost(request, context)) return null;

  const slug = resolveTenantSlugFromHost(request, context);
  if (slug) {
    const bySlug = await db.org.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }

  const defaultOrg = await db.org.findUnique({ where: { slug: "default" } });
  if (defaultOrg) return defaultOrg;
  return db.org.findFirst({ orderBy: { createdAt: "asc" } });
}

async function loadSession(
  db: ReturnType<typeof getPrisma>,
  request: Request,
  context: any,
): Promise<SessionFacts> {
  let user: User | null = null;
  let impersonatedOrgId: string | null = null;
  let impersonatedBy: string | null = null;
  try {
    const auth = getAuth(context);
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user?.id) {
      user = await db.user.findUnique({ where: { id: session.user.id } });
      if (user?.role === "CALLER") {
        // Migrate legacy CALLER role on read.
        user = await db.user.update({
          where: { id: user.id },
          data: { role: "CONTROLLER" },
        });
      }
      impersonatedOrgId =
        (session.session as { impersonatedOrgId?: string | null } | null)
          ?.impersonatedOrgId ?? null;
    }
    impersonatedBy =
      (session?.session as { impersonatedBy?: string | null } | undefined)
        ?.impersonatedBy ?? null;
  } catch {
    // Anonymous board access — no session is fine.
  }
  return { user, impersonatedOrgId, impersonatedBy };
}

function enforceConsoleRedirects(args: {
  request: Request;
  context: any;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
  onMarketingHost: boolean;
  impersonation: ImpersonationState;
}) {
  const { request, context, path, user, org, onMarketingHost, impersonation } =
    args;
  if (
    onMarketingHost ||
    !user ||
    !org ||
    path.skipTenantOrgBinding ||
    impersonation.active
  ) {
    return;
  }
  if (isPlatformAdmin(user, context) && user.orgId !== org.id) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/platform`);
  }
  if (user.role === "ADMIN" && user.districtId && !user.orgId) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/district`);
  }
}

async function enforceTenantOrgMatch(args: {
  db: ReturnType<typeof getPrisma>;
  request: Request;
  context: any;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
  onMarketingHost: boolean;
  impersonation: ImpersonationState;
}) {
  const { db, request, context, path, user, org, onMarketingHost, impersonation } =
    args;
  if (
    onMarketingHost ||
    !user ||
    !org ||
    path.skipTenantOrgBinding ||
    isPlatformAdmin(user, context) ||
    impersonation.active
  ) {
    return;
  }
  const sameOrg = !!user.orgId && user.orgId === org.id;
  if (sameOrg) return;

  if (user.orgId) {
    const userOrgRow = await db.org.findUnique({
      where: { id: user.orgId },
      select: { slug: true },
    });
    if (userOrgRow?.slug) {
      throw redirect(tenantBoardUrlFromRequest(request, userOrgRow.slug));
    }
  }
  throw redirect(`${marketingOriginFromRequest(request, context)}/signup`);
}

async function enforceAnonymousAccess(args: {
  request: Request;
  context: any;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
}) {
  const { request, context, path, user, org } = args;
  if (user || path.anonSkipsViewer) return;

  const url = new URL(request.url);
  const nextPath = `${url.pathname}${url.search}`;

  if (path.isPlatform || !org) {
    throw redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const hasAccess = await hasValidViewerAccess({ request, context });
  if (!hasAccess) {
    throw redirect(`/viewer-access?next=${encodeURIComponent(nextPath)}`);
  }
}

async function enforceBillingGate(args: {
  db: ReturnType<typeof getPrisma>;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
}) {
  const { db, path, user, org } = args;
  if (!user || !org || path.exemptFromBillingGate) return;

  const district = org.districtId
    ? await db.district.findUnique({
        where: { id: org.districtId },
        select: { status: true, compedUntil: true, isComped: true },
      })
    : undefined;
  if (org.districtId && !district) {
    throw redirect("/billing-required");
  }
  if (
    !isOrgAccessAllowed(
      { org, district: district ?? undefined },
      new Date(),
    )
  ) {
    throw redirect("/billing-required");
  }
}
