import type { AudienceMembership } from "./live-redirect.server";

/**
 * May this caller write to a live drill run — checklist cells, classroom
 * attestations, notes, and follow-up items?
 *
 * Any signed-in org member may. That deliberately includes
 * `User.role === "VIEWER"`: `teacher-import.server.ts` assigns imported
 * classroom teachers either "VIEWER" or "CONTROLLER", so a VIEWER-role
 * account is the ordinary shape of a teacher — and attesting their own room
 * is the primary reason drills exist. Narrowing this to ADMIN/CONTROLLER
 * would lock teachers out of the one action they are here to perform.
 *
 * Magic-code guests (VIEWER_PIN) hold no `User` row. They may watch an
 * EVERYONE drill, but never write to it.
 *
 * Lifecycle actions (pause / resume / end) are a *separate*, stricter gate —
 * see `requireAdmin()` in `app/routes/drills.live.tsx`.
 */
export function canEditDrillRun(membership: AudienceMembership): boolean {
  return membership === "STAFF";
}
