/**
 * Org-scoped audit trail for admin mutations.
 *
 * This is the org-level analogue of `app/domain/district/audit.server.ts`. It
 * records "who did what, on whose behalf, from where, and what changed" for the
 * tenant admin surface (branding, students, households, users, settings, ...)
 * into the `OrgAuditLog` table, so a change like a swapped branding logo has a
 * defensible record (think AWS CloudTrail).
 *
 * Performance contract: logging must never slow down the admin action. We write
 * fire-and-forget via Cloudflare's `ctx.waitUntil()` — the row is persisted
 * *after* the response is sent. Routes call `await auditOrgAction(...)`, but on
 * Workers that await resolves immediately (the write is handed to `waitUntil`
 * and the function returns before it runs); only the test/non-Workers path
 * actually awaits the DB write, so suites can observe it deterministically. This
 * is the same idiom as the `fanOut` broadcast helper in `update.$space.tsx`.
 */
import { getPrisma } from "~/db.server";
import { getAuditContextFromRequest } from "~/domain/auth/audit-context.server";
import { getOrgFromContext } from "~/domain/utils/global-context.server";

/**
 * Canonical, namespaced list of org-level audit actions. Add new strings here
 * rather than inlining literals at call sites, so the platform views can map
 * every code to a friendly label. `comp.*` predates this module (billing) and
 * is kept for back-compat.
 */
export const ORG_AUDIT_ACTIONS = [
  // billing (pre-existing)
  "comp.set",
  "comp.clear",
  // branding
  "branding.update",
  // students
  "student.create",
  "student.update",
  "student.move",
  "student.delete",
  // households
  "household.create",
  "household.update",
  "household.delete",
  "household.merge",
  "household.assign",
  "household.detachStudent",
  // dismissal exceptions / program cancellations
  "exception.create",
  "exception.deactivate",
  "cancellation.broadcast",
  // users / access
  "user.invite",
  "user.role.changed",
  "user.password.reset",
  "user.passwordReset.policy",
  "user.banned",
  "user.unbanned",
  "user.deleted",
  "user.sessions.revoked",
  "user.impersonate.start",
  "viewer.pin.changed",
  "viewer.magiclink.created",
  "viewer.lock.reset",
  "viewer.access.revoked",
  // classrooms
  "classroom.update",
  // drill templates (live-run events live in DrillRunEvent, not here)
  "drill.template.created",
  "drill.template.updated",
  "drill.template.deleted",
  // roster import
  "roster.import.applied",
  // settings
  "settings.update",
  "settings.board.reset",
  "settings.retention.changed",
] as const;

export type OrgAuditAction = (typeof ORG_AUDIT_ACTIONS)[number];

export type OrgAuditDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/** Treat `undefined` and `null` as the same "unset" so an absent→absent field
 * is not recorded as a change. */
function valueChanged(before: unknown, after: unknown): boolean {
  const b = before === undefined ? null : before;
  const a = after === undefined ? null : after;
  if (b === null && a === null) return false;
  return !Object.is(b, a);
}

/**
 * Build a minimal before/after diff over `keys`, keeping only the fields whose
 * value actually changed. Pure — unit-testable without a DB.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): OrgAuditDiff {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of keys) {
    const bv = before?.[key];
    const av = after?.[key];
    if (valueChanged(bv, av)) {
      b[key] = bv ?? null;
      a[key] = av ?? null;
    }
  }
  return { before: b, after: a };
}

/** True when a diff recorded no changed fields (a genuine no-op submit). */
export function isDiffEmpty(diff: OrgAuditDiff): boolean {
  return Object.keys(diff.after).length === 0;
}

export type WriteOrgAuditInput = {
  context: any;
  orgId: string;
  actorUserId: string | null;
  /**
   * The impersonated user's id when the action was performed via better-auth
   * impersonation; null otherwise. Together with `actorUserId` this forms the
   * canonical audit pair (real human + on-behalf target).
   */
  onBehalfOfUserId?: string | null;
  actorEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  action: OrgAuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  payload?: unknown;
};

/**
 * Low-level insert. Prefer `auditOrgAction` from route handlers (it resolves the
 * actor/network context and schedules the write off the response path). Direct
 * callers — e.g. billing comp changes — already hold an explicit orgId.
 */
export async function writeOrgAudit(input: WriteOrgAuditInput): Promise<void> {
  const db = getPrisma(input.context);
  // Cast to any: the new columns (actorEmail/ipAddress/userAgent/targetType/
  // targetId) land in the generated client the next time `prisma generate` runs
  // against migration 0042. The cast keeps server code buildable without a local
  // schema-engine regeneration, matching the existing `recordOrgAudit` pattern.
  await (db as any).orgAuditLog.create({
    data: {
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      onBehalfOfUserId: input.onBehalfOfUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload:
        input.payload === undefined
          ? undefined
          : (input.payload as object | null | undefined),
    },
  });
}

export type AuditOrgActionInput = {
  action: OrgAuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  /**
   * Provide `before`/`after` objects plus `keys` to record a minimal diff. When
   * a diff is supplied and nothing changed, no row is written (unless `always`).
   * Alternatively pass an explicit `payload` for create/delete/summary events.
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  keys?: readonly string[];
  payload?: unknown;
  /** Write even when the computed diff is empty (e.g. delete with no diff). */
  always?: boolean;
};

/**
 * Record an admin mutation, off the response path.
 *
 * Routes should `await` the returned value: on Workers it resolves immediately
 * (the DB write is handed to `ctx.waitUntil`), so the user's click is never
 * blocked; off-Workers (tests) the returned promise resolves once the row is
 * written. Failures are swallowed with a warning — audit logging must never
 * turn a successful mutation into a 500.
 *
 * Returns early (no row) when a diff was requested and nothing changed.
 */
export function auditOrgAction(
  context: any,
  request: Request,
  input: AuditOrgActionInput,
): void | Promise<void> {
  const org = getOrgFromContext(context);
  const { actor, ipAddress, userAgent } = getAuditContextFromRequest(
    request,
    context,
  );

  let payload: unknown = input.payload;
  if (payload === undefined && input.keys) {
    const diff = diffFields(input.before, input.after, input.keys);
    if (!input.always && isDiffEmpty(diff)) {
      return; // genuine no-op submit — nothing worth recording
    }
    payload = diff;
  }

  const cfCtx = (context as { cloudflare?: { ctx?: ExecutionContext } })
    .cloudflare?.ctx;

  const safe = (async () => {
    try {
      // Snapshot the actor's email so the entry survives a later user deletion.
      // Resolved here, inside the deferred task, so the extra read never blocks
      // the response.
      let actorEmail: string | null = null;
      if (actor.actorUserId) {
        const db = getPrisma(context);
        const u = await db.user.findUnique({
          where: { id: actor.actorUserId },
          select: { email: true },
        });
        actorEmail = u?.email ?? null;
      }
      await writeOrgAudit({
        context,
        orgId: org.id,
        actorUserId: actor.actorUserId,
        onBehalfOfUserId: actor.onBehalfOfUserId,
        actorEmail,
        ipAddress,
        userAgent,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        payload,
      });
    } catch (err) {
      console.warn(`[org-audit] failed to record ${input.action}`, err);
    }
  })();

  if (cfCtx && typeof cfCtx.waitUntil === "function") {
    cfCtx.waitUntil(safe);
    return;
  }
  // Test / non-Workers path: hand the promise back so callers can await a
  // deterministic write.
  return safe;
}

/** Most-recent-first audit rows for an org, for the platform views. */
export async function listOrgAudit(
  context: any,
  orgId: string,
  limit = 100,
): Promise<any[]> {
  const db = getPrisma(context);
  return (db as any).orgAuditLog.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
