import type { User } from "~/db";

/**
 * Inputs to the live-drill redirect decision.
 *
 * We keep this a pure function of (user, pathname, hasActiveDrill) so it's
 * trivial to unit-test without mocking Prisma / request objects.
 */
export interface LiveRedirectInput {
  /** The authenticated user, or null for anonymous visitors. */
  user: Pick<User, "id" | "role"> | null;
  /** Lowercased `URL.pathname` of the incoming request. */
  pathname: string;
  /**
   * True if `getActiveDrillRun(prisma, org.id)` returned a LIVE or PAUSED run.
   * Callers should only compute this when cheap / necessary (i.e. skip on
   * marketing hosts and for anonymous requests).
   */
  hasActiveDrill: boolean;
  /**
   * True if the user is an admin (role ADMIN or CONTROLLER). Admins can reach
   * any route even during a live drill so they can manage it, so we never
   * redirect them into the takeover.
   */
  isAdmin: boolean;
}

/**
 * Paths that must remain reachable during a live drill, even for non-admin
 * signed-in users. Uses prefix matching for nested groups (api/*, assets/*).
 *
 * - The takeover itself (/drills/live) must not redirect to itself.
 * - Auth flows (logout, set-password, login) must work so users can fix
 *   session state.
 * - /api/* endpoints (notably /api/auth/*) are invoked by fetch / better-auth
 *   and should never be swapped for a 302 HTML response.
 * - Static assets never need to go through the takeover.
 */
const ALLOW_PATHS: readonly string[] = ["/drills/live", "/logout", "/set-password"];
const ALLOW_PREFIXES: readonly string[] = [
  "/api/",
  "/assets/",
  "/build/",
];

/**
 * Pure function: returns the path to redirect the caller to, or `null` if no
 * redirect should happen. Designed to be called from the root loader.
 *
 * Decision table:
 *   - No user (anonymous):            never redirect (they hit other auth flows)
 *   - User is admin/controller:       never redirect (must be able to manage)
 *   - No active drill:                never redirect
 *   - Path is in the allow-list:      never redirect
 *   - Otherwise:                      redirect to "/drills/live"
 */
export function liveDrillRedirectTarget(
  input: LiveRedirectInput,
): string | null {
  if (!input.user) return null;
  if (input.isAdmin) return null;
  if (!input.hasActiveDrill) return null;

  const path = input.pathname || "/";
  if (ALLOW_PATHS.includes(path)) return null;
  for (const prefix of ALLOW_PREFIXES) {
    if (path.startsWith(prefix)) return null;
  }

  return "/drills/live";
}

/**
 * Returns true for ADMIN and CONTROLLER roles — the two roles that currently
 * have admin-tier permissions (see `protectToAdminAndGetPermissions`).
 */
export function userIsAdmin(
  user: Pick<User, "role"> | null | undefined,
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || user.role === "CONTROLLER";
}
