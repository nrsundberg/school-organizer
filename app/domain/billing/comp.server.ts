import { getPrisma } from "~/db.server";
import { writeOrgAudit } from "~/domain/org/audit.server";

/**
 * Billing/platform audit shim. Kept for its existing platform-side callers
 * (comp changes, org creation, invites); it now delegates to the single
 * `writeOrgAudit` writer in `~/domain/org/audit.server` so there's one place
 * that owns the `OrgAuditLog` insert.
 */
export async function recordOrgAudit(params: {
  context: any;
  orgId: string;
  actorUserId: string | null;
  /**
   * The impersonated user's id when the action was performed via better-auth
   * impersonation; null otherwise. Together with `actorUserId` this forms the
   * canonical audit pair (real human + on-behalf target). Resolve from
   * `getActorIdsFromContext(context)` at the route boundary so every writer
   * captures both halves.
   */
  onBehalfOfUserId?: string | null;
  action: string;
  payload?: unknown;
}) {
  await writeOrgAudit(params);
}

export async function setOrgComp(params: {
  context: any;
  orgId: string;
  compedUntil: Date | null;
  billingNote: string | null;
  actorUserId: string | null;
  onBehalfOfUserId?: string | null;
}) {
  const {
    context,
    orgId,
    compedUntil,
    billingNote,
    actorUserId,
    onBehalfOfUserId,
  } = params;
  const db = getPrisma(context);

  await db.org.update({
    where: { id: orgId },
    data: {
      compedUntil,
      billingNote,
    },
  });

  await recordOrgAudit({
    context,
    orgId,
    actorUserId,
    onBehalfOfUserId,
    action: "comp.set",
    payload: {
      compedUntil: compedUntil?.toISOString() ?? null,
      billingNote,
    },
  });
}

export async function clearOrgComp(params: {
  context: any;
  orgId: string;
  actorUserId: string | null;
  onBehalfOfUserId?: string | null;
}) {
  const { context, orgId, actorUserId, onBehalfOfUserId } = params;
  const db = getPrisma(context);

  await db.org.update({
    where: { id: orgId },
    data: { compedUntil: null },
  });

  await recordOrgAudit({
    context,
    orgId,
    actorUserId,
    onBehalfOfUserId,
    action: "comp.clear",
    payload: null,
  });
}
