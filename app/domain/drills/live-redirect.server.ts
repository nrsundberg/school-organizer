import type { User } from "~/db";
import type { DrillAudience } from "./types";

/**
 * Caller's audience-membership category.
 *
 * - STAFF       — any signed-in User in this org (ADMIN, CONTROLLER, TEACHER,
 *                 or User.role === "VIEWER" — the latter is a real low-perm
 *                 account, NOT the magic-code viewer-pin concept).
 * - VIEWER_PIN  — anonymous (no `User`) but holds a valid viewer-pin session
 *                 cookie via `hasValidViewerAccess`.
 * - NONE        — fully anonymous; never redirected.
 */
export type AudienceMembership = "STAFF" | "VIEWER_PIN" | "NONE";

/**
 * Inputs to the live-drill audience-membership gate.
 *
 * Pure function of (membership, audience, pathname) so it's trivial to
 * unit-test without mocking Prisma / request objects.
 */
export interface LiveRedirectInput {
  /** Caller's audience-membership category. */
  membership: AudienceMembership;
  /**
   * Audience of the currently-LIVE-or-PAUSED run, or `null` if none.
   * Callers should only compute this when cheap / necessary (i.e. skip on
   * marketing hosts and when membership is "NONE").
   */
  audience: DrillAudience | null;
  /** Lowercased `URL.pathname` of the incoming request. */
  pathname: string;
}

/**
 * Paths that must remain reachable during a live drill, even for in-audience
 * callers. Uses prefix matching for nested groups (api/*, admin/*, assets/*).
 *
 * - /drills/live: the takeover itself must not redirect to itself.
 * - /logout, /set-password: auth flows must work so users can fix session state.
 * - /api/*: invoked by fetch / better-auth — never swap for a 302 HTML response.
 * - /admin/*: admins must reach admin pages mid-drill (billing, roster).
 *   They are still redirected on first arrival to `/`, which is the
 *   canonical takeover trigger.
 * - /assets/*, /build/*: static assets.
 */
const ALLOW_PATHS: readonly string[] = ["/drills/live", "/logout", "/set-password"];
const ALLOW_PREFIXES: readonly string[] = [
  "/api/",
  "/admin/",
  "/assets/",
  "/build/",
];

/**
 * Returns true when the caller's `membership` is in the run's `audience`.
 *
 *   audience    | STAFF | VIEWER_PIN | NONE
 *   ------------+-------+------------+------
 *   STAFF_ONLY  |  ✓    |    ✗       |  ✗
 *   EVERYONE    |  ✓    |    ✓       |  ✗
 */
export function isInAudience(
  membership: AudienceMembership,
  audience: DrillAudience,
): boolean {
  if (membership === "NONE") return false;
  if (audience === "EVERYONE") return true;
  // audience === "STAFF_ONLY"
  return membership === "STAFF";
}

/**
 * Pure function: returns the path to redirect the caller to, or `null` if no
 * redirect should happen. Designed to be called from the root loader.
 *
 * Decision table:
 *   - audience is null (no active drill):       null
 *   - membership not in audience:               null
 *   - path is in the allow-list:                null
 *   - otherwise:                                "/drills/live"
 */
export function liveDrillRedirectTarget(
  input: LiveRedirectInput,
): string | null {
  if (input.audience === null) return null;
  if (!isInAudience(input.membership, input.audience)) return null;

  const path = input.pathname || "/";
  if (ALLOW_PATHS.includes(path)) return null;
  for (const prefix of ALLOW_PREFIXES) {
    if (path.startsWith(prefix)) return null;
  }

  return "/drills/live";
}

/**
 * @deprecated Temporary shim during the audience-visibility rollout — kept so
 * Tasks 5/6 can compile after this refactor and before they delete the
 * remaining call sites. Will be removed in Task 6.
 */
export function userIsAdmin(
  user: Pick<User, "role"> | null | undefined,
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || user.role === "CONTROLLER";
}
