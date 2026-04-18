import type { MiddlewareFunction } from "react-router";
import { createContext, redirect } from "react-router";
import type { Org, User } from "~/db";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import { isOrgStatusAllowedForApp } from "~/domain/billing/org-status";

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

async function resolveOrgByHost(db: ReturnType<typeof getPrisma>, request: Request): Promise<Org | null> {
  const host = new URL(request.url).host.toLowerCase().split(":")[0];
  const subdomain = host.split(".")[0] ?? null;
  return db.org.findFirst({
    where: {
      OR: [
        { customDomain: host },
        ...(subdomain ? [{ slug: subdomain }] : []),
      ],
    },
  });
}

export const globalStorageMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const db = getPrisma(context);
  let user: User | null = null;
  let org: Org | null = null;

  try {
    org = await resolveOrgByHost(db, request);
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
  if (!org && user?.orgId) {
    org = await db.org.findUnique({ where: { id: user.orgId } });
  }
  context.set(orgContext, org);

  const url = new URL(request.url);
  const isSetPassword = url.pathname === "/set-password";
  const isApi = url.pathname.startsWith("/api/");
  const isLogout = url.pathname === "/logout";
  const isLogin = url.pathname === "/login";
  const isViewerAccess = url.pathname === "/viewer-access";
  const isBillingRequired = url.pathname === "/billing-required";
  const isOnboardingApi = url.pathname === "/api/onboarding";
  const isStripeWebhook = url.pathname === "/api/webhooks/stripe";
  const isAuthApi = url.pathname.startsWith("/api/auth/");
  const isStatic = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/build/") || url.pathname === "/favicon.ico";

  if (user?.mustChangePassword && !isSetPassword && !isApi && !isLogout) {
    throw redirect("/set-password");
  }

  if (!user && !isLogin && !isLogout && !isViewerAccess && !isAuthApi && !isStatic) {
    const hasAccess = await hasValidViewerAccess({ request, context });
    if (!hasAccess) {
      const nextPath = `${url.pathname}${url.search}`;
      throw redirect(`/viewer-access?next=${encodeURIComponent(nextPath)}`);
    }
  }

  if (
    user &&
    org &&
    !isOrgStatusAllowedForApp(org.status) &&
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
