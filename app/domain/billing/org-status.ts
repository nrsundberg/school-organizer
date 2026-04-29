import type { OrgStatus } from "~/db";

const ALLOWED_APP_STATUSES: ReadonlySet<OrgStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

type AccessSlice = {
  status: OrgStatus;
  compedUntil: Date | null;
  isComped: boolean;
};

type AccessInput = {
  org: AccessSlice & { districtId: string | null };
  district?: AccessSlice;
};

/**
 * Whether an org should be allowed to access the in-app experience.
 *
 * For standalone orgs (`districtId == null`), uses the org's own
 * status / compedUntil / isComped.
 *
 * For district-attached orgs, the org's own billing fields are unused
 * (per schema comment on Org.districtId) — access is governed entirely
 * by the district's status. The district payload MUST be provided in
 * that case; passing `districtId` without `district` is a caller bug.
 *
 * If this returns `false`, callers MUST NOT serve app data — typically
 * by throwing a redirect to /billing-required.
 */
export function isOrgAccessAllowed(input: AccessInput, now: Date): boolean {
  if (input.org.districtId != null) {
    if (!input.district) {
      throw new Error(
        "isOrgAccessAllowed: district-attached org requires a district payload",
      );
    }
    return isStatusAllowed(input.district, now);
  }
  return isStatusAllowed(input.org, now);
}

function isStatusAllowed(entity: AccessSlice, now: Date): boolean {
  if (entity.isComped) return true;
  if (entity.compedUntil != null && entity.compedUntil > now) return true;
  return ALLOWED_APP_STATUSES.has(entity.status);
}

export function mapStripeSubscriptionStatusToOrgStatus(
  status: string | null | undefined,
): OrgStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
      return "INCOMPLETE";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}
