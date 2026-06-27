/**
 * Pure helpers for the /admin/data-export action: column whitelists, row
 * filtering, and manifest construction. Lives outside the route file so the
 * unit suite (`data-export.server.test.ts`) can exercise them without
 * spinning up a Worker context or a Prisma client.
 *
 * Whitelisting is INTENTIONALLY a positive list — every column we ship has
 * to be opted in by name. This way new schema columns (especially anything
 * sensitive: tokens, hashes, internal IDs from a third party) default to
 * NOT being exported. The cost is a one-line update here when a new column
 * needs to leave the org; the win is that a future
 * `prisma.user.findMany({})` call can never accidentally leak
 * `passwordHash` because the column was added after this file was written.
 *
 * See docs/nightly-specs/2026-04-27-data-export-delete.md § 4 + Open Q #3
 * for the rationale and the source-of-truth column list.
 */

export type ExportTable =
  | "students"
  | "teachers"
  | "spaces"
  | "callEvents"
  | "users"
  | "households"
  | "dismissalExceptions"
  | "afterSchoolPrograms"
  | "programCancellations"
  | "appSettings"
  | "auditLog";

/**
 * Per-table column whitelist. Every key listed here is included verbatim
 * (after Date → ISO string normalization) in the exported JSON; every key
 * NOT listed is silently dropped. See module doc for the policy.
 */
export const EXPORT_WHITELIST: Record<ExportTable, readonly string[]> = {
  students: [
    "id",
    "firstName",
    "lastName",
    "homeRoom",
    "spaceNumber",
    "householdId",
  ],
  teachers: ["id", "homeRoom", "locale"],
  spaces: ["id", "spaceNumber", "status", "timestamp"],
  callEvents: [
    "id",
    "spaceNumber",
    "studentId",
    "studentName",
    "homeRoomSnapshot",
    "actorUserId",
    "onBehalfOfUserId",
    "createdAt",
  ],
  // NOTE: passwordHash is intentionally NOT in this list. The unit test
  // asserts no whitelisted user row contains that key. If you add columns
  // here without a security review, expect the test to flag it.
  users: [
    "id",
    "email",
    "name",
    "phone",
    "role",
    "locale",
    "createdAt",
  ],
  households: [
    "id",
    "name",
    "pickupNotes",
    "primaryContactName",
    "primaryContactPhone",
    "createdAt",
    "updatedAt",
  ],
  dismissalExceptions: [
    "id",
    "studentId",
    "householdId",
    "scheduleKind",
    "exceptionDate",
    "dayOfWeek",
    "startsOn",
    "endsOn",
    "dismissalPlan",
    "pickupContactName",
    "notes",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
  afterSchoolPrograms: [
    "id",
    "name",
    "description",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
  programCancellations: [
    "id",
    "programId",
    "cancellationDate",
    "title",
    "message",
    "deliveryMode",
    "createdByUserId",
    "createdAt",
    "updatedAt",
  ],
  // viewerPinHash is dropped: it's a hashed PIN with the org's user
  // population behind it, useless to the school and a credential-stuffing
  // foothold if leaked.
  appSettings: ["orgId", "viewerDrawingEnabled"],
  // OrgAuditLog is included in the export per Open Q #1: the school has a
  // legitimate "what did we do" interest. The action strings + payloads we
  // record are pickup-roster artifacts, not third-party PII.
  auditLog: ["id", "actorUserId", "action", "payload", "createdAt"],
};

/**
 * Strip a row to whitelisted keys only and normalize Date instances to ISO
 * strings (so the resulting JSON is round-trippable through any reader).
 *
 * We deliberately keep nested objects (Prisma `Json` payloads on
 * OrgAuditLog) opaque — JSON.stringify handles them fine.
 */
export function whitelistRow<T extends Record<string, unknown>>(
  table: ExportTable,
  row: T,
): Record<string, unknown> {
  const cols = EXPORT_WHITELIST[table];
  const out: Record<string, unknown> = {};
  for (const key of cols) {
    if (!(key in row)) continue;
    const v = row[key];
    if (v instanceof Date) {
      out[key] = v.toISOString();
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Build the top-level manifest.json that ships at the root of every export.
 * `schemaVersion` exists so a future export consumer can branch on shape
 * changes without parsing the data.
 */
export function buildManifest(params: {
  orgId: string;
  orgSlug: string;
  exportedAt: Date | string;
  exportedByUserId: string | null;
  planAtExport: string | null;
  rowCounts: Partial<Record<ExportTable, number>>;
}): Record<string, unknown> {
  const exportedAt =
    params.exportedAt instanceof Date
      ? params.exportedAt.toISOString()
      : params.exportedAt;
  return {
    schemaVersion: "1",
    orgId: params.orgId,
    orgSlug: params.orgSlug,
    exportedAt,
    exportedByUserId: params.exportedByUserId,
    planAtExport: params.planAtExport,
    rowCounts: params.rowCounts,
  };
}

/**
 * The fixed delete order for /admin/data-delete. Listed here so the same
 * array literal drives both the action's transaction body and the unit
 * test's snapshot — drift between the two would silently leak FK
 * violations into staging.
 *
 * Order respects the FK chain: dependents before parents. `User` is last
 * (and is an `orgId,NOT:{id:me.id}` filter at the call site).
 */
export const DELETE_ORDER: readonly string[] = [
  "programCancellation",
  "afterSchoolProgram",
  "dismissalException",
  "callEvent",
  "viewerAccessSession",
  "viewerAccessAttempt",
  "viewerMagicLink",
  "appSettings",
  "student",
  "teacher",
  "space",
  "household",
  "drillRunEvent",
  "drillRun",
  "drillTemplate",
  "user",
];
