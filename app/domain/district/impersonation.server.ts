import { getPrisma } from "~/db.server";
import { writeDistrictAudit } from "./audit.server";

type Caller = {
  id: string;
  districtId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
};
type Target = { id: string; districtId: string | null };

export type CanImpersonateResult = { ok: true } | { ok: false; reason: string };

export function canImpersonate(
  caller: Caller,
  target: Target,
): CanImpersonateResult {
  if (!caller.districtId) {
    return { ok: false, reason: "Caller is not a district admin." };
  }
  if (target.districtId == null) {
    return { ok: false, reason: "Target school is not part of any district." };
  }
  if (target.districtId !== caller.districtId) {
    return { ok: false, reason: "Target school belongs to a different district." };
  }
  return { ok: true };
}

export async function startImpersonation(
  context: any,
  args: {
    caller: Caller & { email?: string | null };
    sessionId: string;
    orgId: string;
  },
): Promise<{ orgId: string; orgSlug: string; orgName: string }> {
  const db = getPrisma(context);
  const target = await db.org.findUnique({ where: { id: args.orgId } });
  if (!target) throw new Error("School not found.");
  const check = canImpersonate(args.caller, {
    id: target.id,
    districtId: target.districtId,
  });
  if (!check.ok) throw new Error(check.reason);

  await db.session.update({
    where: { id: args.sessionId },
    data: { impersonatedOrgId: target.id },
  });
  await writeDistrictAudit(context, {
    districtId: args.caller.districtId!,
    actorUserId: args.caller.id,
    actorEmail: args.caller.email ?? null,
    action: "district.impersonate.start",
    targetType: "Org",
    targetId: target.id,
    details: { orgSlug: target.slug, orgName: target.name },
  });

  return { orgId: target.id, orgSlug: target.slug, orgName: target.name };
}

export async function endImpersonation(
  context: any,
  args: {
    caller: Caller & { email?: string | null };
    sessionId: string;
  },
): Promise<void> {
  const db = getPrisma(context);
  const session = await db.session.findUnique({
    where: { id: args.sessionId },
  });
  const orgId =
    (session as { impersonatedOrgId?: string | null } | null)
      ?.impersonatedOrgId ?? null;
  await db.session.update({
    where: { id: args.sessionId },
    data: { impersonatedOrgId: null },
  });
  if (args.caller.districtId && orgId) {
    await writeDistrictAudit(context, {
      districtId: args.caller.districtId,
      actorUserId: args.caller.id,
      actorEmail: args.caller.email ?? null,
      action: "district.impersonate.end",
      targetType: "Org",
      targetId: orgId,
    });
  }
}
