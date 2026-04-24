import type { MiddlewareFunction } from "react-router";
import { createContext, redirect } from "react-router";
import type { Org, User } from "~/db";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import { isOrgStatusAllowedForApp } from "~/domain/billing/org-status";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import {
  isMarketingHost,
  isPlatformAdmin,
  marketingOriginFromRequest,
  resolveTenantSlugFromHost,
} from "~/domain/utils/host.server";

export const userContext = createContext<User | null>(null);
export const orgContext = createContext<Org | null>(null);

export const getOptionalUserFromContext = (context: any): User | null => {
  return context.get(userContext) ?? null;
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
  context: any,
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
  next,
) => {
  const db = getPrisma(context);
  let user: User | null = null;
  let org: Org | null = null;

  try {
    org = await resolveOrgByHost(db, request, context);
  } catch {
    // Host-to-org resolution is best-effort during rollout.
  }

  try {
    const auth = getAuth(context);
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    if (session?.user?.id) {
      user = await db.user.findUnique({ where: { id: session.user.id } });
      if (user?.role === "CALLER") {
        user = await db.user.update({
          where: { id: user.id },
          data: { role: "CONTROLLER" },
        });
      }
    }
  } catch {
    // No session — that's fine, board is public
  }

  context.set(userContext, user);

  const onMarketingHost = isMarketingHost(request, context);
  if (!onMarketingHost && !org && user?.orgId) {
    org = await db.org.findUnique({ where: { id: user.orgId } });
  }
  if (onMarketingHost) {
    org = null;
  }
  context.set(orgContext, org);

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
  const isPlatform = pathname.startsWith("/platform");

  const publicMarketingPath =
    pathname === "/pricing" ||
    pathname === "/faqs" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    (pathname === "/signup" && onMarketingHost) ||
    (pathname.startsWith("/api/onboarding") && onMarketingHost) ||
    (pathname === "/" && onMarketingHost);

  if (user?.mustChangePassword && !isSetPassword && !isApi && !isLogout) {
    throw redirect("/set-password");
  }

  const skipTenantOrgBinding = isStatic || isAuthApi || isStripeWebhook;
  if (
    !onMarketingHost &&
    user &&
    org &&
    !skipTenantOrgBinding &&
    !isPlatformAdmin(user, context)
  ) {
    const sameOrg = !!user.orgId && user.orgId === org.id;
    if (!sameOrg) {
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
    !isOrgStatusAllowedForApp(org.status, { isComped: !!(org as any).isComped }) &&
    !isBillingRequired &&
    !isOnboardingApi &&
    !isStripeWebhook &&
    !isAuthApi &&
    !isStatic
  ) {
    throw redirect("/billing-required");
  }

  return next();
};
