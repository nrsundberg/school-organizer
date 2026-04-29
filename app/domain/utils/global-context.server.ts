import type { MiddlewareFunction } from "react-router";
import { createContext, redirect } from "react-router";
import type { Org, User } from "~/db";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import { isOrgAccessAllowed } from "~/domain/billing/org-status";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import {
  isMarketingHost,
  isPlatformAdmin,
  marketingOriginFromRequest,
  resolveTenantSlugFromHost
} from "~/domain/utils/host.server";
import {
  resolveActorIds,
  type ActorIds
} from "~/domain/auth/impersonate-gate.server";

export const userContext = createContext<User | null>(null);
export const orgContext = createContext<Org | null>(null);

// Two distinct impersonation surfaces:
//
// - `impersonatedByContext` carries the better-auth platform-admin → user
//   impersonation (admin acting AS another User). It feeds the actor-pair
//   (actorUserId / onBehalfOfUserId) on write paths (CallEvent, DrillRun).
//
// - `impersonationContext` carries the district-admin → school impersonation
//   (district admin acting INTO a child Org). It does NOT change the user;
//   it only redirects tenant-extension queries to the impersonated org and
//   drives the visible "End impersonation" banner.
//
// They can stack — a platform admin who is acting as a district admin user
// could in principle start a district impersonation. The nested-impersonation
// gate on master refuses better-auth nested impersonation; district
// impersonation is gated separately by `requireDistrictAdmin`.
export const impersonationContext = createContext<{
  active: boolean;
  orgId: string | null;
} | null>(null);
export const impersonatedByContext = createContext<string | null>(null);

export const getOptionalUserFromContext = (context: any): User | null => {
  return context.get(userContext) ?? null;
};

export const getImpersonationFromContext = (
  context: any,
): { active: boolean; orgId: string | null } => {
  return context.get(impersonationContext) ?? { active: false, orgId: null };
};

export const getImpersonatedByFromContext = (context: any): string | null => {
  return context.get(impersonatedByContext) ?? null;
};

/**
 * Resolve the audit pair (actorUserId, onBehalfOfUserId) for the current
 * request. `actorUserId` is the human who clicked (admin's id when
 * impersonating); `onBehalfOfUserId` is the impersonated user's id, or null.
 *
 * For anonymous viewer requests (no session) both are null.
 */
export const getActorIdsFromContext = (context: any): ActorIds => {
  const user = getOptionalUserFromContext(context);
  const impersonatedBy = getImpersonatedByFromContext(context);
  return resolveActorIds(user?.id ?? null, impersonatedBy);
};

export const getUserFromContext = (context: any): User => {
  const user = context.get(userContext);
  if (!user) {
    throw new Error("User should be available here");
  }
  return user;
};

export const getOptionalOrgFromContext = (context: any): Org | null => {
  return context.get(orgContext) ?? null;
};

export const getOrgFromContext = (context: any): Org => {
  const org = context.get(orgContext);
  if (!org) {
    throw new Error("Org should be available here");
  }
  return org;
};

export const getTenantPrisma = (context: any) => {
  const org = getOrgFromContext(context);
  return getPrisma(context, org.id);
};

async function resolveOrgByHost(
  db: ReturnType<typeof getPrisma>,
  request: Request,
  context: any
): Promise<Org | null> {
  const host = new URL(request.url).host.toLowerCase().split(":")[0];

  const byCustom = await db.org.findFirst({ where: { customDomain: host } });
  if (byCustom) return byCustom;

  if (isMarketingHost(request, context)) {
    return null;
  }

  const slug = resolveTenantSlugFromHost(request, context);
  if (slug) {
    const bySlug = await db.org.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }

  const defaultOrg = await db.org.findUnique({ where: { slug: "default" } });
  if (defaultOrg) return defaultOrg;
  return db.org.findFirst({ orderBy: { createdAt: "asc" } });
}

export const globalStorageMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const db = getPrisma(context);
  let user: User | null = null;
  let org: Org | null = null;

  try {
    org = await resolveOrgByHost(db, request, context);
  } catch {
    // Host-to-org resolution is best-effort during rollout.
  }

  let impersonatedOrgId: string | null = null;
  let impersonatedBy: string | null = null;
  try {
    const auth = getAuth(context);
    const session = await auth.api.getSession({
      headers: request.headers
    });
    if (session?.user?.id) {
      user = await db.user.findUnique({ where: { id: session.user.id } });
      if (user?.role === "CALLER") {
        user = await db.user.update({
          where: { id: user.id },
          data: { role: "CONTROLLER" }
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
    // No session — that's fine, board is public
  }

  context.set(userContext, user);
  context.set(impersonatedByContext, impersonatedBy);

  const onMarketingHost = isMarketingHost(request, context);
  // Impersonation takes precedence over both host-resolved and user.orgId.
  // When a district admin (or platform admin) has an active impersonation,
  // the request operates as that org and the existing tenant-extension
  // scopes accordingly — no per-route changes required.
  if (!onMarketingHost && impersonatedOrgId) {
    const impOrg = await db.org.findUnique({ where: { id: impersonatedOrgId } });
    if (impOrg) org = impOrg;
  } else if (!onMarketingHost && !org && user?.orgId) {
    org = await db.org.findUnique({ where: { id: user.orgId } });
  }
  if (onMarketingHost) {
    org = null;
  }
  context.set(orgContext, org);
  context.set(impersonationContext, {
    active: impersonatedOrgId != null && org?.id === impersonatedOrgId,
    orgId: impersonatedOrgId,
  });

  const url = new URL(request.url);
  const pathname = url.pathname;
  const isSetPassword = pathname === "/set-password";
  const isApi = pathname.startsWith("/api/");
  const isLogout = pathname === "/logout";
  const isLogin = pathname === "/login";
  const isForgotPassword = pathname === "/forgot-password";
  const isResetPassword = pathname === "/reset-password";
  const isViewerAccess = pathname === "/viewer-access";
  const isBillingRequired = pathname === "/billing-required";
  const isOnboardingApi = pathname === "/api/onboarding";
  const isStripeWebhook = pathname === "/api/webhooks/stripe";
  const isAuthApi = pathname.startsWith("/api/auth/");
  const isStatic =
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/build/") ||
    pathname === "/favicon.ico";
  const isCheckEmailApi = pathname === "/api/check-email";
  const isCheckOrgSlugApi = pathname === "/api/check-org-slug";
  const isBrandingLogoApi = pathname.startsWith("/api/branding/logo/");
  const isHealthz = pathname === "/api/healthz";
  const isPlatform = pathname.startsWith("/platform");

  const publicMarketingPath =
    pathname === "/pricing" ||
    pathname === "/faqs" ||
    pathname === "/status" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/guides" ||
    pathname.startsWith("/guides/") ||
    (pathname === "/signup" && onMarketingHost) ||
    (pathname === "/district/signup" && onMarketingHost) ||
    (pathname.startsWith("/api/onboarding") && onMarketingHost) ||
    (pathname === "/" && onMarketingHost);

  if (user?.mustChangePassword && !isSetPassword && !isApi && !isLogout) {
    throw redirect("/set-password");
  }

  const skipTenantOrgBinding =
    isStatic || isAuthApi || isStripeWebhook || isLogout;
  // District admins are allowed onto a tenant org's pages while impersonating.
  // Without this carve-out, the sameOrg check below would bounce them since
  // `User.orgId` is null for district-scoped users.
  const isImpersonatingThisOrg =
    impersonatedOrgId != null && impersonatedOrgId === org?.id;

  // Platform and district staff don't operate on tenant data unless they've
  // explicitly impersonated this org. Without this, they hit a tenant
  // subdomain and either get a confusing 403 (platform admin) or a wrong
  // /signup redirect (district admin). Send them back to their console.
  if (
    !onMarketingHost &&
    user &&
    org &&
    !skipTenantOrgBinding &&
    !isImpersonatingThisOrg
  ) {
    if (isPlatformAdmin(user, context) && user.orgId !== org.id) {
      throw redirect(`${marketingOriginFromRequest(request, context)}/platform`);
    }
    if (user.role === "ADMIN" && user.districtId && !user.orgId) {
      throw redirect(`${marketingOriginFromRequest(request, context)}/district`);
    }
  }

  if (
    !onMarketingHost &&
    user &&
    org &&
    !skipTenantOrgBinding &&
    !isPlatformAdmin(user, context) &&
    !isImpersonatingThisOrg
  ) {
    const sameOrg = !!user.orgId && user.orgId === org.id;
    if (!sameOrg) {
      if (user.orgId) {
        const userOrgRow = await db.org.findUnique({
          where: { id: user.orgId },
          select: { slug: true }
        });
        if (userOrgRow?.slug) {
          throw redirect(tenantBoardUrlFromRequest(request, userOrgRow.slug));
        }
      }
      throw redirect(`${marketingOriginFromRequest(request, context)}/signup`);
    }
  }

  const anonSkipsViewer =
    isLogin ||
    isLogout ||
    isForgotPassword ||
    isResetPassword ||
    isViewerAccess ||
    isAuthApi ||
    isStatic ||
    isCheckEmailApi ||
    isCheckOrgSlugApi ||
    isBrandingLogoApi ||
    isHealthz ||
    publicMarketingPath;

  if (!user && !anonSkipsViewer) {
    if (isPlatform) {
      const nextPath = `${pathname}${url.search}`;
      throw redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    if (!org) {
      const nextPath = `${pathname}${url.search}`;
      throw redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    const hasAccess = await hasValidViewerAccess({ request, context });
    if (!hasAccess) {
      const nextPath = `${pathname}${url.search}`;
      throw redirect(`/viewer-access?next=${encodeURIComponent(nextPath)}`);
    }
  }

  if (
    user &&
    org &&
    !isBillingRequired &&
    !isOnboardingApi &&
    !isStripeWebhook &&
    !isAuthApi &&
    !isStatic
  ) {
    const district = org.districtId
      ? await db.district.findUnique({
          where: { id: org.districtId },
          select: { status: true, compedUntil: true, isComped: true },
        })
      : undefined;
    if (org.districtId && !district) {
      throw redirect("/billing-required");
    }
    if (!isOrgAccessAllowed({ org, district: district ?? undefined }, new Date())) {
      throw redirect("/billing-required");
    }
  }

  return next();
};
