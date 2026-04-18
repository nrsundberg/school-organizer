import type { OrgStatus } from "~/db";

const ALLOWED_APP_STATUSES: ReadonlySet<OrgStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export function isOrgStatusAllowedForApp(status: OrgStatus): boolean {
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

