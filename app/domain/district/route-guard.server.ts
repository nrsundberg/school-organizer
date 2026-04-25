import { redirect } from "react-router";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export type DistrictGuardOutcome =
  | { kind: "redirect"; to: string }
  | { kind: "allow-district"; districtId: string }
  | { kind: "allow-platform" };

type GuardableUser = {
  orgId: string | null;
  districtId: string | null;
  isPlatformAdmin: boolean;
} | null;

export function resolveDistrictGuardOutcome(
  user: GuardableUser,
): DistrictGuardOutcome {
  if (!user) return { kind: "redirect", to: "/login" };
  if (user.isPlatformAdmin) return { kind: "allow-platform" };
  if (user.districtId) return { kind: "allow-district", districtId: user.districtId };
  if (user.orgId) return { kind: "redirect", to: "/admin" };
  return { kind: "redirect", to: "/login" };
}

/**
 * Convenience for route loaders: throws a redirect or returns the districtId.
 *
 * Platform admins land on a 400 — they should reach a district through the
 * staff panel (`/admin/districts/:slug`), not the customer-facing portal.
 */
export function requireDistrictAdmin(context: any): string {
  const user = getOptionalUserFromContext(context);
  const guardableUser: GuardableUser = user
    ? {
        orgId: (user as { orgId?: string | null }).orgId ?? null,
        districtId: (user as { districtId?: string | null }).districtId ?? null,
        isPlatformAdmin:
          (user as { role?: string }).role === "PLATFORM_ADMIN",
      }
    : null;
  const outcome = resolveDistrictGuardOutcome(guardableUser);
  if (outcome.kind === "redirect") throw redirect(outcome.to);
  if (outcome.kind === "allow-platform") {
    throw new Response(
      "Use the staff panel to view a specific district.",
      { status: 400 },
    );
  }
  return outcome.districtId;
}
