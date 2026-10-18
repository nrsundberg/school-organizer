/**
 * School-admin view of `OrgAuditLog`.
 *
 * The table is tenant-scoped (`OrgAuditLog` is in `TENANT_MODELS`), and every
 * school-facing read also passes `schoolAuditLogWhere` so a missed extension
 * still cannot return another org's rows. Platform and impersonation actions
 * are written onto the *target* org's log (a platform admin impersonating
 * this school, changing its plan, and so on). Those rows stay in the table
 * for the platform audit page; they are omitted everywhere a school admin
 * can read them.
 */

/** Actions a school admin must never see, even when `orgId` is their own. */
export const SCHOOL_HIDDEN_AUDIT_ACTIONS = [
  "impersonate.start",
  "impersonate.end",
  "user.impersonate.start",
  "district.impersonate.start",
  "district.impersonate.end",
  "comp.set",
  "comp.clear",
  "comp.toggle_on",
  "comp.toggle_off",
  "plan.manual_change",
  "trial.extend",
  "org.limits_overridden",
  "org.comp_created",
  "branding.custom_domain",
] as const;

const HIDDEN = new Set<string>(SCHOOL_HIDDEN_AUDIT_ACTIONS);

export type SchoolAuditRow = {
  orgId: string;
  action: string;
};

/** Prisma `where` for school-admin audit reads. Always pins `orgId`. */
export function schoolAuditLogWhere(orgId: string) {
  return {
    orgId,
    action: { notIn: [...SCHOOL_HIDDEN_AUDIT_ACTIONS] },
  };
}

/**
 * In-memory form of `schoolAuditLogWhere`. A brand-new org id keeps only
 * rows that belong to it and that are ordinary school activity.
 */
export function visibleSchoolAuditLogs<T extends SchoolAuditRow>(
  orgId: string,
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.orgId === orgId && !HIDDEN.has(row.action));
}
