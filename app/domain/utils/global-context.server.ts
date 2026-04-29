import type { MiddlewareFunction } from "react-router";
import { createContext } from "react-router";
import type { Org, User } from "~/db";
import { getPrisma } from "~/db.server";
import {
  resolveActorIds,
  type ActorIds,
} from "~/domain/auth/impersonate-gate.server";
import {
  resolveRequestScope,
  type ResolvedRequestScope,
} from "~/domain/request-scope/resolve.server";

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

// The full resolver output. Loaders that want to read derived fields not
// surfaced through the legacy contexts (e.g. `realOrg`, `actor`) should
// consume this directly via `getRequestScopeFromContext` rather than calling
// `resolveRequestScope` themselves — re-running the resolver re-runs the
// entire redirect/billing decision tree.
export const requestScopeContext = createContext<ResolvedRequestScope | null>(
  null,
);

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

/**
 * Thin coupling layer between the request lifecycle and `resolveRequestScope`.
 *
 * The resolver owns the full decision tree (host → org, session, console
 * redirects, tenant-org match, viewer access, billing gate); this middleware
 * just persists its output into the legacy contexts so existing route
 * loaders that call `getOrgFromContext` / `getUserFromContext` keep working
 * unchanged.
 */
export const getRequestScopeFromContext = (
  context: any,
): ResolvedRequestScope | null => {
  return context.get(requestScopeContext) ?? null;
};

export const globalStorageMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const scope = await resolveRequestScope(request, context);
  context.set(requestScopeContext, scope);
  context.set(userContext, scope.user);
  context.set(orgContext, scope.org);
  context.set(impersonationContext, {
    active: scope.impersonation.active,
    orgId: scope.impersonation.orgId,
  });
  context.set(impersonatedByContext, scope.impersonation.byUserId);
  return next();
};
