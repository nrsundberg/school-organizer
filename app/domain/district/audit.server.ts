import { getPrisma } from "~/db.server";

export const DISTRICT_AUDIT_ACTIONS = [
  "district.admin.invited",
  "district.admin.removed",
  "district.school.created",
  "district.school.cap.exceeded",
  "district.impersonate.start",
  "district.impersonate.end",
  "district.billing.note.changed",
  "district.schoolCap.changed",
  "district.trialEndsAt.changed",
  "district.comp.changed",
] as const;

export type DistrictAuditAction = (typeof DISTRICT_AUDIT_ACTIONS)[number];

export type WriteAuditInput = {
  districtId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: DistrictAuditAction;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

export async function writeDistrictAudit(
  context: any,
  input: WriteAuditInput,
): Promise<void> {
  const db = getPrisma(context);
  await db.districtAuditLog.create({
    data: {
      districtId: input.districtId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
    },
  });
}

export async function listDistrictAudit(
  context: any,
  districtId: string,
  limit = 100,
) {
  const db = getPrisma(context);
  return db.districtAuditLog.findMany({
    where: { districtId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
