import type { OrgStatus } from "~/db";

const ALLOWED_APP_STATUSES: ReadonlySet<OrgStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

/**
 * Whether an org should be allowed to access the in-app experience based on
 * its billing status.
 *
 * Comped orgs (`isComped = true`) bypass status checks entirely — staff can
 * flip a comp on/off from the platform admin panel. This is distinct from
 * `compedUntil`, which is a time-bounded comp window used by the existing
 * comp.server logic.
 */
export function isOrgStatusAllowedForApp(
  status: OrgStatus,
  options?: { isComped?: boolean },
): boolean {
  if (options?.isComped) return true;
  return ALLOWED_APP_STATUSES.has(status);
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
