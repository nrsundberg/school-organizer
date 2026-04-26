/**
 * Audit invariant: at most one level of impersonation at a time.
 *
 * Better-auth's admin plugin does not refuse `startImpersonating` when the
 * current session is already an impersonation session — it would silently
 * overwrite `Session.impersonatedBy` and lose the original admin's identity.
 * For a defensible audit trail we need to know "who really clicked this",
 * so we reject nested impersonation here and return a code the UI can
 * surface as a toast.
 */

export const IMPERSONATION_NESTED_CODE = "IMPERSONATION_NESTED";

/**
 * Returns a 403 Response when the current session is already an
 * impersonation session (i.e. `Session.impersonatedBy` is non-null).
 * Returns null when it is safe to proceed with a new impersonation.
 */
export function assertNotAlreadyImpersonating(
  currentSessionImpersonatedBy: string | null | undefined,
): Response | null {
  if (!currentSessionImpersonatedBy) return null;
  return new Response(
    JSON.stringify({
      message:
        "You are already impersonating another user. Stop the current impersonation before starting a new one.",
      code: IMPERSONATION_NESTED_CODE,
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export interface ActorIds {
  /** The human who clicked. Admin's id when impersonating; the user themself otherwise. */
  actorUserId: string | null;
  /** The impersonated user's id when impersonating; null otherwise. */
  onBehalfOfUserId: string | null;
}

/**
 * Map (effective session user, impersonatedBy) onto the audit pair.
 *
 * better-auth model:
 *   - `session.user.id`              — effective user (the impersonated one when impersonating)
 *   - `session.session.impersonatedBy` — admin's id when impersonating, else null
 *
 * Audit pair:
 *   - actorUserId       — the human who clicked
 *   - onBehalfOfUserId  — the user they were impersonating, or null
 */
export function resolveActorIds(
  sessionUserId: string | null | undefined,
  impersonatedBy: string | null | undefined,
): ActorIds {
  if (!sessionUserId) {
    return { actorUserId: null, onBehalfOfUserId: null };
  }
  if (!impersonatedBy) {
    return { actorUserId: sessionUserId, onBehalfOfUserId: null };
  }
  return { actorUserId: impersonatedBy, onBehalfOfUserId: sessionUserId };
}
