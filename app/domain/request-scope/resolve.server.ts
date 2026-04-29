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
 *
 * Dependency injection: every external collaborator (db, session loader,
 * host helpers, viewer-access check, clock) is funneled through `ResolveDeps`.
 * Production callers use `buildResolveDeps(context)`; tests pass fakes
 * directly without needing a Cloudflare context shim.
 */

import { redirect } from "react-router";
import type { Org, User } from "~/db";
import type { PrismaClient } from "~/db/generated/client";
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

export type SessionFacts = {
  user: User | null;
  impersonatedOrgId: string | null;
  impersonatedBy: string | null;
};

/**
 * Everything the resolver needs from the outside world. Production wiring
 * lives in `buildResolveDeps`; tests construct this directly with fakes.
 */
export type ResolveDeps = {
  db: PrismaClient;
  loadSession: (request: Request) => Promise<SessionFacts>;
  hasViewerAccess: (request: Request) => Promise<boolean>;
  isMarketingHost: (request: Request) => boolean;
  isPlatformAdmin: (user: User) => boolean;
  marketingOrigin: (request: Request) => string;
  resolveTenantSlug: (request: Request) => string | null;
  tenantBoardUrl: (request: Request, slug: string) => string;
  now: () => Date;
};

export function buildResolveDeps(context: any): ResolveDeps {
  const db = getPrisma(context);
  return {
    db,
    loadSession: (request) => loadBetterAuthSession(db, request, context),
    hasViewerAccess: (request) => hasValidViewerAccess({ request, context }),
    isMarketingHost: (request) => isMarketingHost(request, context),
    isPlatformAdmin: (user) => isPlatformAdmin(user, context),
    marketingOrigin: (request) => marketingOriginFromRequest(request, context),
    resolveTenantSlug: (request) => resolveTenantSlugFromHost(request, context),
    tenantBoardUrl: (request, slug) => tenantBoardUrlFromRequest(request, slug),
    now: () => new Date(),
  };
}

export async function resolveRequestScope(
  request: Request,
  context: any,
  deps: ResolveDeps = buildResolveDeps(context),
): Promise<ResolvedRequestScope> {
  const url = new URL(request.url);
  const onMarketingHost = deps.isMarketingHost(request);
  const path = classifyRequestPath(url.pathname, onMarketingHost);

  const hostOrg = await resolveOrgByHost(deps, request).catch(() => null);
  const session = await deps.loadSession(request);

  // Apply impersonation overlay. Impersonation takes precedence over both
  // host-resolved and user.orgId.
  let org: Org | null = hostOrg;
  let realOrg: Org | null = null;
  if (!onMarketingHost && session.impersonatedOrgId) {
    const impOrg = await deps.db.org.findUnique({
      where: { id: session.impersonatedOrgId },
    });
    if (impOrg) {
      org = impOrg;
      // The user's "real" org is whatever they'd be on without the overlay.
      if (session.user?.orgId && session.user.orgId !== impOrg.id) {
        realOrg = await deps.db.org.findUnique({
          where: { id: session.user.orgId },
        });
      }
    }
  } else if (!onMarketingHost && !org && session.user?.orgId) {
    org = await deps.db.org.findUnique({
      where: { id: session.user.orgId },
    });
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
    deps,
    request,
    path,
    user: session.user,
    org,
    onMarketingHost,
    impersonation,
  });

  // Tenant ↔ org match: a regular user on the wrong tenant gets redirected
  // to their home org's URL (or to /signup if their account has no org).
  await enforceTenantOrgMatch({
    deps,
    request,
    path,
    user: session.user,
    org,
    onMarketingHost,
    impersonation,
  });

  // Anonymous-viewer access: no session, on a tenant org, must hold a valid
  // viewer-access cookie unless the path is anon-skippable.
  await enforceAnonymousAccess({
    deps,
    request,
    path,
    user: session.user,
    org,
  });

  // Billing gate: authed user + org → must pass `isOrgAccessAllowed`,
  // including district-deference when the org is part of a district.
  await enforceBillingGate({
    deps,
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
// Internals — each rule isolated for readability and testability.
// Exported so unit tests can target them without re-running the full pipe.
// ---------------------------------------------------------------------------

async function resolveOrgByHost(
  deps: ResolveDeps,
  request: Request,
): Promise<Org | null> {
  const host = new URL(request.url).host.toLowerCase().split(":")[0];
  const byCustom = await deps.db.org.findFirst({
    where: { customDomain: host },
  });
  if (byCustom) return byCustom;

  if (deps.isMarketingHost(request)) return null;

  const slug = deps.resolveTenantSlug(request);
  if (slug) {
    const bySlug = await deps.db.org.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }

  const defaultOrg = await deps.db.org.findUnique({
    where: { slug: "default" },
  });
  if (defaultOrg) return defaultOrg;
  return deps.db.org.findFirst({ orderBy: { createdAt: "asc" } });
}

async function loadBetterAuthSession(
  db: PrismaClient,
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

export function enforceConsoleRedirects(args: {
  deps: ResolveDeps;
  request: Request;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
  onMarketingHost: boolean;
  impersonation: ImpersonationState;
}) {
  const { deps, request, path, user, org, onMarketingHost, impersonation } =
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
  if (deps.isPlatformAdmin(user) && user.orgId !== org.id) {
    throw redirect(`${deps.marketingOrigin(request)}/platform`);
  }
  if (user.role === "ADMIN" && user.districtId && !user.orgId) {
    throw redirect(`${deps.marketingOrigin(request)}/district`);
  }
}

export async function enforceTenantOrgMatch(args: {
  deps: ResolveDeps;
  request: Request;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
  onMarketingHost: boolean;
  impersonation: ImpersonationState;
}) {
  const { deps, request, path, user, org, onMarketingHost, impersonation } =
    args;
  if (
    onMarketingHost ||
    !user ||
    !org ||
    path.skipTenantOrgBinding ||
    deps.isPlatformAdmin(user) ||
    impersonation.active
  ) {
    return;
  }
  const sameOrg = !!user.orgId && user.orgId === org.id;
  if (sameOrg) return;

  if (user.orgId) {
    const userOrgRow = await deps.db.org.findUnique({
      where: { id: user.orgId },
      select: { slug: true },
    });
    if (userOrgRow?.slug) {
      throw redirect(deps.tenantBoardUrl(request, userOrgRow.slug));
    }
  }
  throw redirect(`${deps.marketingOrigin(request)}/signup`);
}

export async function enforceAnonymousAccess(args: {
  deps: ResolveDeps;
  request: Request;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
}) {
  const { deps, request, path, user, org } = args;
  if (user || path.anonSkipsViewer) return;

  const url = new URL(request.url);
  const nextPath = `${url.pathname}${url.search}`;

  if (path.isPlatform || !org) {
    throw redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const hasAccess = await deps.hasViewerAccess(request);
  if (!hasAccess) {
    throw redirect(`/viewer-access?next=${encodeURIComponent(nextPath)}`);
  }
}

export async function enforceBillingGate(args: {
  deps: ResolveDeps;
  path: ReturnType<typeof classifyRequestPath>;
  user: User | null;
  org: Org | null;
}) {
  const { deps, path, user, org } = args;
  if (!user || !org || path.exemptFromBillingGate) return;

  const district = org.districtId
    ? await deps.db.district.findUnique({
        where: { id: org.districtId },
        select: { status: true, compedUntil: true, isComped: true },
      })
    : undefined;
  if (org.districtId && !district) {
    throw redirect("/billing-required");
  }
  if (
    !isOrgAccessAllowed({ org, district: district ?? undefined }, deps.now())
  ) {
    throw redirect("/billing-required");
  }
}
