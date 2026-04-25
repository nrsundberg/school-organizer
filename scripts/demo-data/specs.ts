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
  /** Approx household count — siblings will be grouped to hit this number. */
  householdCount: number;
  /** Number of past CallEvents to replay across the trailing 21 days. */
  pastCallEvents: number;
  /** Number of after-school programs to seed. */
  programCount: number;
  /** Optional district group key — sibling orgs share this string. */
  districtKey?: string;
  /** Pool of teacher last names that classroom homeRooms are built from. */
  teacherLastNamesSeed: number;
  /** Stable seed for deterministic name selection. */
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
    teacherLastNamesSeed: 1,
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
    teacherLastNamesSeed: 2,
    randomSeed: 2002,
  },
  // District trio — same brand palette so they read as one district visually.
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
    teacherLastNamesSeed: 3,
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
    teacherLastNamesSeed: 4,
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
    teacherLastNamesSeed: 5,
    randomSeed: 3005,
  },
] as const;

/**
 * Drill templates each demo org gets cloned (subset of GLOBAL_TEMPLATES).
 * Keep this list short — admins add their own in the demo to show the
 * library picker, so the seeded list should not look "complete".
 */
export const DEMO_DRILL_GLOBAL_KEYS: readonly string[] = [
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
export const HISTORICAL_RUN_KEYS: readonly string[] = [
  "fire-evacuation",
  "lockdown-srp",
] as const;
