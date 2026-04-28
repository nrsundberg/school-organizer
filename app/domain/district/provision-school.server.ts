import type { District, Org } from "~/db";
import { getPrisma } from "~/db.server";
import { slugifyOrgName } from "~/lib/org-slug";
import { writeDistrictAudit } from "./audit.server";
import { computeCapState, getDistrictSchoolCount } from "./district.server";
import { inviteUser } from "~/domain/admin-users/invite-user.server";

export type ProvisionInput = {
  schoolName: string;
  schoolSlug: string;
  adminEmail: string;
  adminName: string;
};

export function validateSchoolProvisioningInput(
  raw: ProvisionInput,
): ProvisionInput {
  const schoolName = raw.schoolName.trim();
  const schoolSlug = slugifyOrgName(raw.schoolSlug);
  const adminEmail = raw.adminEmail.trim().toLowerCase();
  const adminName = raw.adminName.trim();
  if (!schoolName) throw new Error("School name is required.");
  if (!schoolSlug) throw new Error("Valid school slug is required.");
  if (!adminEmail) throw new Error("Admin email is required.");
  if (!adminName) throw new Error("Admin name is required.");
  return { schoolName, schoolSlug, adminEmail, adminName };
}

/**
 * Create a school under a district. Soft cap: if the district is at/over its
 * `schoolCap`, the school is still created and an audit-log entry is written.
 *
 * The school admin is created passwordless via the magic-link invite flow —
 * they get an email with a link to /accept-invite, set their password, and
 * are signed in for the first time.
 *
 * `actor.onBehalfOfUserId` is the impersonated user's id when the calling
 * staff member is acting via better-auth impersonation (resolve from
 * `getActorIdsFromContext` at the route boundary). It threads onto every
 * audit row so the trail captures both halves of the actor pair.
 */
export async function provisionSchoolForDistrict(
  context: any,
  args: {
    request: Request;
    district: District;
    actor: {
      id: string;
      email: string | null;
      onBehalfOfUserId?: string | null;
    };
    input: ProvisionInput;
  },
): Promise<{ org: Org; capExceeded: boolean }> {
  const input = validateSchoolProvisioningInput(args.input);
  const db = getPrisma(context);

  const slugTaken = await db.org.findUnique({
    where: { slug: input.schoolSlug },
  });
  if (slugTaken) throw new Error("That school slug is already in use.");

  const beforeCount = await getDistrictSchoolCount(context, args.district.id);

  const org = await db.org.create({
    data: {
      name: input.schoolName,
      slug: input.schoolSlug,
      billingPlan: "DISTRICT",
      // School inherits the district trial status. The school admin
      // signs in via the invite link and runs the existing onboarding
      // pipeline on first load.
      status: "TRIALING",
      districtId: args.district.id,
    },
  });

  const result = await inviteUser(context, {
    request: args.request,
    email: input.adminEmail,
    name: input.adminName,
    role: "ADMIN",
    scope: { kind: "org", id: org.id },
    invitedByUserId: args.actor.id,
    invitedByOnBehalfOfUserId: args.actor.onBehalfOfUserId ?? null,
    invitedByEmail: args.actor.email,
    invitedToLabel: org.name,
  });
  if (!result.ok) {
    // Roll the org back so the district doesn't end up with an orphan school
    // counted against its cap.
    await db.org.delete({ where: { id: org.id } }).catch(() => {});
    if (result.error === "user-exists") {
      throw new Error(
        "A user with that email already exists. Use a different admin email or have the existing user join the school.",
      );
    }
    throw new Error("Could not create the school admin user.");
  }

  await writeDistrictAudit(context, {
    districtId: args.district.id,
    actorUserId: args.actor.id,
    onBehalfOfUserId: args.actor.onBehalfOfUserId ?? null,
    actorEmail: args.actor.email,
    action: "district.school.created",
    targetType: "Org",
    targetId: org.id,
    details: { slug: org.slug, name: org.name },
  });

  const after = computeCapState(beforeCount + 1, args.district.schoolCap);
  if (after.state === "over") {
    await writeDistrictAudit(context, {
      districtId: args.district.id,
      actorUserId: args.actor.id,
      onBehalfOfUserId: args.actor.onBehalfOfUserId ?? null,
      actorEmail: args.actor.email,
      action: "district.school.cap.exceeded",
      targetType: "District",
      targetId: args.district.id,
      details: { count: after.count, cap: after.cap, over: after.over },
    });
  }

  return { org, capExceeded: after.state === "over" };
}
