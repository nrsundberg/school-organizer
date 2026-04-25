export type UserScopeFields = {
  orgId: string | null;
  districtId: string | null;
  isPlatformAdmin: boolean;
};

export type UserScope = "school" | "district" | "platform" | "unassigned";

/**
 * Throws if the user does not have exactly one of `orgId`, `districtId`,
 * or `isPlatformAdmin` set. Prisma cannot model XOR; this is the
 * application-layer guarantor of the invariant.
 */
export function assertUserScopeXor(fields: UserScopeFields): void {
  const set = [
    fields.orgId != null,
    fields.districtId != null,
    fields.isPlatformAdmin === true,
  ].filter(Boolean).length;
  if (set !== 1) {
    throw new Error(
      "User must have exactly one of orgId, districtId, or isPlatformAdmin set.",
    );
  }
}

export function classifyUserScope(fields: UserScopeFields): UserScope {
  if (fields.isPlatformAdmin) return "platform";
  if (fields.districtId != null) return "district";
  if (fields.orgId != null) return "school";
  return "unassigned";
}
