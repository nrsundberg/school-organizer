import { getPrisma } from "~/db.server";

export async function recordOrgAudit(params: {
  context: any;
  orgId: string;
  actorUserId: string | null;
  action: string;
  payload?: unknown;
}) {
  const { context, orgId, actorUserId, action, payload } = params;
  const db = getPrisma(context);
  // Cast to any: OrgAuditLog is a new Prisma model; the generated client gets
  // this delegate the next time `prisma generate` runs against the updated
  // schema. This keeps the server code buildable without forcing a local
  // regeneration (which requires the schema engine binary).
  await (db as any).orgAuditLog.create({
    data: {
      orgId,
      actorUserId: actorUserId ?? null,
      action,
      payload:
        payload === undefined
          ? undefined
          : (payload as object | null | undefined),
    },
  });
}

export async function setOrgComp(params: {
  context: any;
  orgId: string;
  compedUntil: Date | null;
  billingNote: string | null;
  actorUserId: string | null;
}) {
  const { context, orgId, compedUntil, billingNote, actorUserId } = params;
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
}) {
  const { context, orgId, actorUserId } = params;
  const db = getPrisma(context);

  await db.org.update({
    where: { id: orgId },
    data: { compedUntil: null },
  });

  await recordOrgAudit({
    context,
    orgId,
    actorUserId,
    action: "comp.clear",
    payload: null,
  });
}
