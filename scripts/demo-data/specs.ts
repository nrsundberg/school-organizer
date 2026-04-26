// scripts/demo-data/specs.ts
//
// Pure data — every demo tenant we seed into local / staging / production.
// No DB calls live here; this module is consumed by `generate.ts`.
//
// Slug rules: must end in "-example" so anyone scanning the orgs list (or
// the platform admin panel) can immediately tell a demo from a real
// tenant. The "-example" suffix is also long enough that a real school
// signing up as "lincoln" or "bhs" cannot collide.
//
// Stable IDs ("org_demo_<key>") let the seed be idempotent: re-running
// deletes by orgId then re-inserts.

// `DEMO_DRILL_GLOBAL_KEYS` strings must each match a `globalKey` in
// `app/domain/drills/library.ts` (the GLOBAL_TEMPLATES array). The
// generator (Task 5) validates by calling `getGlobalTemplate(key)` and
// throws if any are missing — but a typo here will only surface at
// generate-time, not type-check time. Keep this list short and review
// it when the library is updated.

// We define this union locally rather than importing the canonical
// `BillingPlan` from `app/db` (Prisma) or `~/lib/plan-limits` because:
//   1. This module is consumed by a Node-only CLI script and we want
//      to keep its dependency footprint to zero (no prisma client, no
//      app/* imports — the script must run in any cwd, including from
//      a tarball without `prisma generate` having been run).
//   2. We intentionally omit FREE / STARTER / ENTERPRISE — demos only
//      showcase the public paid tiers. If the canonical enum changes,
//      the per-org INSERT in Task 5 will surface a runtime error
//      against D1's CHECK constraint, which is a deliberate failure
//      mode (loud > silent drift).
export type DemoBillingPlan = "CAR_LINE" | "CAMPUS" | "DISTRICT";

export interface DemoTenantSpec {
  /** Stable Org.id used by the wipe + insert SQL. */
  orgId: string;
  /** Public slug — URL host segment. MUST end in "-example". */
  slug: string;
  /** Display name. */
  name: string;
  /** Stripe billing plan. FREE is excluded — demos showcase paid tiers. */
  plan: DemoBillingPlan;
  /** Tenant brand colors (hex, validated by /admin/branding). */
  brandColor: string;
  brandAccentColor: string;
  /** Roster sizing. Stay well under the plan cap so admins can demo a row add. */
  studentCount: number;
  classroomCount: number;
  /**
   * Approximate household count. The generator creates exactly this many
   * Household rows; ~30% are assigned a sibling (2 students) and the
   * rest get 1, giving an average ratio of ~1.3 student per household.
   * If `studentCount` exceeds that capacity the generator wraps and
   * existing households receive a third (or more) student — preserves
   * FK integrity but means a few siblings groups will look larger than
   * the ~30% target. For Lincoln (350/220 ≈ 1.59) this is intentional.
   */
  householdCount: number;
  /** Number of past CallEvents to replay across the trailing 21 days. */
  pastCallEvents: number;
  /** Number of after-school programs to seed. */
  programCount: number;
  /** Optional district group key — sibling orgs share this string. */
  districtKey?: string;
  /**
   * Offset into the shared `TEACHER_LAST_NAMES` pool (defined in
   * `name-pools.ts`) where this org's classroom homerooms start. Each org
   * uses a different offset so the demo trio doesn't all start with
   * "Atwood, Bishop, ...". Modulo'd against the pool length when read.
   */
  teacherNameOffset: number;
  /**
   * Seed for the per-org PRNG used by the generator: student first/last
   * names, household assignment, and CallEvent timestamp jitter. Does not
   * affect teacher-homeroom names (those use `teacherNameOffset`) so
   * tweaking roster sizes here will not also shuffle classroom names.
   */
  randomSeed: number;
}

export const DEMO_TENANTS: readonly DemoTenantSpec[] = [
  {
    orgId: "org_demo_bhs",
    slug: "bhs-example",
    name: "Black Hills Elementary (Example)",
    plan: "CAR_LINE",
    brandColor: "#1F3A8A",
    brandAccentColor: "#F59E0B",
    studentCount: 120,
    classroomCount: 12,
    householdCount: 80,
    pastCallEvents: 220,
    programCount: 3,
    teacherNameOffset: 1,
    randomSeed: 1001,
  },
  {
    orgId: "org_demo_lincoln",
    slug: "lincoln-example",
    name: "Lincoln Academy (Example)",
    plan: "CAMPUS",
    brandColor: "#0F766E",
    brandAccentColor: "#FDE68A",
    studentCount: 350,
    classroomCount: 28,
    householdCount: 220,
    pastCallEvents: 540,
    programCount: 6,
    teacherNameOffset: 2,
    randomSeed: 2002,
  },
  // District trio — same brand palette so they read as one district visually.
  // Per-school CallEvent counts are intentionally lower than Lincoln per
  // student — older grades historically have less car-line volume than
  // elementary, and we want the district demo to reflect that.
  {
    orgId: "org_demo_westside_elem",
    slug: "westside-elem-example",
    name: "Westside Elementary (Example District)",
    plan: "DISTRICT",
    brandColor: "#7C2D12",
    brandAccentColor: "#FACC15",
    studentCount: 90,
    classroomCount: 10,
    householdCount: 60,
    pastCallEvents: 150,
    programCount: 2,
    districtKey: "westside",
    teacherNameOffset: 3,
    randomSeed: 3003,
  },
  {
    orgId: "org_demo_westside_middle",
    slug: "westside-middle-example",
    name: "Westside Middle School (Example District)",
    plan: "DISTRICT",
    brandColor: "#7C2D12",
    brandAccentColor: "#FACC15",
    studentCount: 110,
    classroomCount: 14,
    householdCount: 75,
    pastCallEvents: 180,
    programCount: 2,
    districtKey: "westside",
    teacherNameOffset: 4,
    randomSeed: 3004,
  },
  {
    orgId: "org_demo_westside_hs",
    slug: "westside-hs-example",
    name: "Westside High School (Example District)",
    plan: "DISTRICT",
    brandColor: "#7C2D12",
    brandAccentColor: "#FACC15",
    studentCount: 140,
    classroomCount: 18,
    householdCount: 95,
    pastCallEvents: 200,
    programCount: 3,
    districtKey: "westside",
    teacherNameOffset: 5,
    randomSeed: 3005,
  },
] as const;

/**
 * District-level rows for the demo. Each district has a `districtKey` that
 * matches one or more `DemoTenantSpec.districtKey` — the generator joins
 * on this to set `Org.districtId` for each member school.
 *
 * District.slug is independent of Org.slug (different table, different
 * UNIQUE) so we keep the `-example` convention so anyone scanning the
 * platform admin panel can immediately tell it's a demo.
 */
export interface DemoDistrictSpec {
  /** Stable District.id used by wipe + insert SQL. */
  districtId: string;
  /** Joins to `DemoTenantSpec.districtKey`. */
  districtKey: string;
  /** District.slug (UNIQUE). */
  slug: string;
  /** District display name. */
  name: string;
  /** District brand colors — typically match the member-school palette. */
  brandColor: string;
  brandAccentColor: string;
}

export const DEMO_DISTRICTS: readonly DemoDistrictSpec[] = [
  {
    districtId: "dist_demo_westside",
    districtKey: "westside",
    slug: "westside-example",
    name: "Westside Unified School District (Example)",
    brandColor: "#7C2D12",
    brandAccentColor: "#FACC15",
  },
] as const;

/**
 * Drill templates each demo org gets cloned (subset of GLOBAL_TEMPLATES).
 * Keep this list short — admins add their own in the demo to show the
 * library picker, so the seeded list should not look "complete".
 */
export const DEMO_DRILL_GLOBAL_KEYS = [
  "fire-evacuation",
  "lockdown-srp",
  "secure-srp",
  "severe-weather-tornado",
  "reunification-srm",
] as const;

/**
 * For each org we seed exactly two ENDED historical DrillRuns: one fire,
 * one lockdown. Toggles are filled in to ~80% so the run looks realistic
 * when replayed for a demo.
 */
export const HISTORICAL_RUN_KEYS = [
  "fire-evacuation",
  "lockdown-srp",
] as const satisfies readonly (typeof DEMO_DRILL_GLOBAL_KEYS)[number][];
