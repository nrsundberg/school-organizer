# Demo Tenants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed durable, idempotent demo tenants — `bhs-example` (CAR_LINE), `lincoln-example` (CAMPUS), and a 3-school DISTRICT trio (`westside-*-example`) — into local dev, staging, and production D1, with admins, classrooms, students, households, drill templates, replayable historical drill runs, and replayable car-pickup CallEvents for Loom recordings and live demos.

**Architecture:** A pure-data spec module (no DB I/O) defines every tenant. A deterministic generator turns specs into ordered SQL statements with stable string IDs (`org_demo_*`, `usr_demo_*`, etc.) so re-running the seed is idempotent — wipe-by-orgId then re-insert. Two appliers consume the generator's output: a libsql applier for local dev (`file:./dev.db`), and a SQL-file emitter that the npm scripts pipe through `wrangler d1 execute --remote --file=...` for staging and production. Demo passwords come from env vars (so secrets never sit in git); a stable fallback is generated and printed when env vars are absent.

**Tech Stack:** TypeScript, `tsx`, `@libsql/client`, `wrangler d1 execute`, existing `e2e/fixtures/seed-helpers.ts` (PBKDF2 password hash, ID generator), Prisma 7 schema (read-only — no schema changes).

**District scope note:** The user has separate in-flight work refining how districts are represented in the DB. This plan does NOT introduce a district aggregation entity — the "district demo" is just three sibling orgs with `billingPlan = 'DISTRICT'` and a shared slug prefix. When the new district model lands, the demo seed will be updated to attach the trio to a parent. Keep the `westside-*-example` orgs cohesive (shared brand colors, related names) so the future migration is a one-line metadata add.

---

## File Structure

```
scripts/
  demo-data/
    specs.ts             # Pure data: tenant definitions (slug, name, plan, sizes, brand)
    name-pools.ts        # Pools of first/last names, classroom themes, program names
    generate.ts          # Deterministic spec → { wipeStmts, seedStmts } generator
    apply-libsql.ts      # Run statements against a libsql DATABASE_URL
    emit-sql.ts          # Serialise statements to one .sql file for wrangler d1 execute
    credentials.ts       # Resolve admin passwords from env vars; print summary
    generate.test.ts     # Tests: determinism, idempotency, FK ordering, plan-cap respect
  seed-demo-tenants.ts   # CLI entry — parses --target, --env, --wipe-only

docs/
  demo-tenants.md        # Operator docs: how to run, what is seeded, how to refresh

migrations/
  (no changes)

prisma/
  (no changes)
```

**Why split this way:**
- `specs.ts` and `name-pools.ts` are pure data — easy to read/diff and to update demo content without touching SQL logic.
- `generate.ts` is the only place that knows the schema. One canonical row-construction routine, two output sinks (libsql vs SQL file), so we can't drift between local and remote runs.
- `apply-libsql.ts` and `emit-sql.ts` are thin — they only translate from `{ sql, args }` to their respective targets. Tests target `generate.ts`, not the appliers.
- The CLI in `scripts/seed-demo-tenants.ts` is intentionally minimal — flag parsing + delegating.

---

## Task 1: Write the demo-tenant specifications

**Files:**
- Create: `scripts/demo-data/specs.ts`

- [ ] **Step 1: Create the specs module**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/demo-data/specs.ts
git commit -m "feat(demo-data): add demo tenant specs"
```

---

## Task 2: Add the synthesis name pools

**Files:**
- Create: `scripts/demo-data/name-pools.ts`

- [ ] **Step 1: Create the name pools**

The demo data needs realistic, varied names. Pull from generic pools — no real student names, no anything that could be mistaken for a real school's roster. Mix culturally diverse first names and last names so the demo doesn't look monocultural.

```ts
// scripts/demo-data/name-pools.ts
//
// Generic, public-domain-style first/last name pools and classroom
// themes used by `generate.ts`. Names were composed by hand to be
// (a) clearly fictional (no real persons), (b) culturally varied, and
// (c) printable in a board screenshot without offending anyone.

export const FIRST_NAMES: readonly string[] = [
  "Aaliyah", "Aiden", "Amara", "Anika", "Arjun", "Asher", "Aurora",
  "Ben", "Beatrix", "Camila", "Caleb", "Carmen", "Chloe", "Daniel",
  "Diego", "Elena", "Eli", "Esme", "Ethan", "Fatima", "Felix",
  "Gabriel", "Greta", "Hana", "Henry", "Ines", "Isaac", "Ivy",
  "Jamal", "Jasmine", "Jaxon", "Jiwoo", "Joelle", "Kai", "Kavya",
  "Kenji", "Kira", "Layla", "Leo", "Liam", "Lina", "Luca", "Maya",
  "Mateo", "Mei", "Mira", "Nadia", "Naya", "Nico", "Noor", "Oliver",
  "Olivia", "Omar", "Pablo", "Penelope", "Priya", "Quinn", "Rafael",
  "Riya", "Rosa", "Sage", "Sami", "Sana", "Santiago", "Sienna",
  "Sofia", "Tahir", "Theo", "Uma", "Valentina", "Wren", "Xavier",
  "Yasmin", "Yusuf", "Zara", "Zion",
];

export const LAST_NAMES: readonly string[] = [
  "Abara", "Adler", "Aguilar", "Akhtar", "Andrade", "Banerjee",
  "Brennan", "Bui", "Calderon", "Campbell", "Chang", "Chen",
  "Cisneros", "Cohen", "Dang", "Diaz", "Doyle", "Dubois", "Edwards",
  "Eze", "Faber", "Fischer", "Foster", "Garcia", "Goh", "Greene",
  "Gupta", "Haddad", "Hassan", "Holt", "Hwang", "Iglesias", "Imani",
  "Iqbal", "Jacobs", "Jain", "Joseph", "Kapoor", "Kato", "Khalil",
  "Kim", "Kirk", "Kovac", "Lal", "Lee", "Lopez", "Madsen", "Mahmoud",
  "Mejia", "Mendoza", "Mwangi", "Nakamura", "Navarro", "Nguyen",
  "Okafor", "Orsini", "Park", "Patel", "Pham", "Pierce", "Quintana",
  "Rahman", "Ramirez", "Reyes", "Rivera", "Saito", "Salazar",
  "Santos", "Shah", "Silva", "Singh", "Sokolov", "Tanaka", "Torres",
  "Ueda", "Vargas", "Vega", "Wang", "Webb", "Williams", "Xu",
  "Yamamoto", "Zhao",
];

/**
 * Teacher last-name pool. Disjoint from LAST_NAMES so there's no overlap
 * between a student's family name and a classroom's homeroom name in the
 * demo. Helpful when demoing the “sibling” feature.
 */
export const TEACHER_LAST_NAMES: readonly string[] = [
  "Atwood", "Bishop", "Carlisle", "Delgado", "Espinoza", "Forrest",
  "Greer", "Hsu", "Iverson", "Jansen", "Kowalski", "Lambert",
  "Martins", "Nakashima", "Okonkwo", "Pereira", "Quinn", "Rasmussen",
  "Soriano", "Talbot", "Underwood", "Voss", "Whitfield", "Yates",
];

export const PROGRAM_NAMES: readonly string[] = [
  "After-School Care",
  "Robotics Club",
  "Drama Club",
  "Chess Club",
  "Soccer (Intramural)",
  "Choir",
  "Math Olympiad",
  "Art Studio",
  "Coding Club",
];
```

- [ ] **Step 2: Commit**

```bash
git add scripts/demo-data/name-pools.ts
git commit -m "feat(demo-data): add name + classroom pools"
```

---

## Task 3: Write the credentials helper

**Files:**
- Create: `scripts/demo-data/credentials.ts`

- [ ] **Step 1: Implement credentials resolution**

```ts
// scripts/demo-data/credentials.ts
//
// Resolves the admin password for each demo tenant. Order of precedence:
//   1. Per-org env var: DEMO_PASSWORD_<UPPER_KEY> (e.g. DEMO_PASSWORD_BHS)
//   2. Global env var:  DEMO_PASSWORD_DEFAULT
//   3. Generated: derived deterministically from DEMO_PASSWORD_SEED so a
//      seeded run + the same seed always yields the same password.
//
// We never hardcode plaintext passwords in git. The function `printSummary`
// prints a single block at the end of a seed run with all admin emails +
// passwords so the operator can record them.

import { createHash } from "node:crypto";
import type { DemoTenantSpec } from "./specs";

const DEFAULT_GENERATED_LENGTH = 16;

/** Convert a slug like "westside-elem-example" → "WESTSIDE_ELEM". */
function envKey(spec: DemoTenantSpec): string {
  return spec.slug
    .replace(/-example$/, "")
    .replace(/-/g, "_")
    .toUpperCase();
}

function deriveFromSeed(seed: string, slug: string): string {
  // Deterministic but not reversible — sha256(seed + slug), base64url
  // truncated. Node's createHash is fine here; this CLI never runs in
  // the Workers runtime so we don't need crypto.subtle.
  const buf = createHash("sha256").update(`${seed}::${slug}`).digest();
  return buf
    .toString("base64")
    .replace(/[+/=]/g, "")
    .slice(0, DEFAULT_GENERATED_LENGTH);
}

export interface DemoCredential {
  slug: string;
  adminEmail: string;
  controllerEmail: string;
  password: string;
  /** True when the password was generated rather than read from env. */
  generated: boolean;
}

export function resolveCredentials(
  specs: readonly DemoTenantSpec[],
  env: NodeJS.ProcessEnv = process.env,
): DemoCredential[] {
  const seed = env.DEMO_PASSWORD_SEED ?? "demo-tenants-fallback-seed";
  const fallback = env.DEMO_PASSWORD_DEFAULT;

  return specs.map((spec) => {
    const perOrg = env[`DEMO_PASSWORD_${envKey(spec)}`];
    const password =
      perOrg && perOrg.length >= 8
        ? perOrg
        : fallback && fallback.length >= 8
          ? fallback
          : deriveFromSeed(seed, spec.slug);
    const generated = !perOrg && !fallback;
    return {
      slug: spec.slug,
      adminEmail: `admin@${spec.slug}.demo`,
      controllerEmail: `controller@${spec.slug}.demo`,
      password,
      generated,
    };
  });
}

export function printSummary(creds: readonly DemoCredential[]): void {
  console.log("\n=== Demo tenant credentials ===");
  console.log("(admins and controllers share one password per org; both can log in)\n");
  for (const c of creds) {
    const tag = c.generated ? " [generated from DEMO_PASSWORD_SEED]" : "";
    console.log(`  ${c.slug}${tag}`);
    console.log(`    admin:      ${c.adminEmail}`);
    console.log(`    controller: ${c.controllerEmail}`);
    console.log(`    password:   ${c.password}\n`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/demo-data/credentials.ts
git commit -m "feat(demo-data): resolve demo admin passwords from env"
```

---

## Task 4: Build the deterministic generator (PRNG + helpers)

**Files:**
- Create: `scripts/demo-data/generate.ts`

The generator outputs `{ wipeStatements, seedStatements }` — both are arrays of `{ sql: string; args: SqlArg[] }`. The wipe runs FK-children-first so re-runs cleanly remove any prior demo data; the seed runs parents-first.

This is a long file. Build it in two halves — Task 4 lays the scaffolding (PRNG, helpers, signatures); Task 5 fills in the row-construction logic.

- [ ] **Step 1: Create generate.ts skeleton**

```ts
// scripts/demo-data/generate.ts
//
// Spec-to-SQL generator. Produces ordered { wipeStatements, seedStatements }
// for every demo tenant defined in specs.ts. Idempotent: wipe deletes
// every row owned by the demo orgIds (using stable string ids); seed then
// re-inserts everything from the spec.
//
// All randomness is deterministic — each tenant has a `randomSeed`
// fed into a tiny xorshift32 PRNG, so two runs with the same specs
// produce identical SQL.
//
// Schema notes:
//   - Org.id, User.id, Account.id, Session.id, DrillTemplate.id,
//     DrillRun.id, Household.id, AppSettings.id, AfterSchoolProgram.id,
//     ProgramCancellation.id, DismissalException.id are TEXT PKs — use
//     stable strings derived from orgId + entity key.
//   - Teacher.id, Student.id, Space.id, CallEvent.id are INTEGER
//     AUTOINCREMENT — the generator does NOT pre-set them. Wipe relies
//     on `WHERE orgId = ?`. Cross-references (e.g. Student.spaceNumber)
//     use the `spaceNumber`, not the id, which is fine because Space
//     has a `(orgId, spaceNumber)` UNIQUE.

import { hashPassword } from "../../e2e/fixtures/seed-helpers";
import {
  DEMO_DRILL_GLOBAL_KEYS,
  HISTORICAL_RUN_KEYS,
  type DemoTenantSpec,
} from "./specs";
import {
  FIRST_NAMES,
  LAST_NAMES,
  PROGRAM_NAMES,
  TEACHER_LAST_NAMES,
} from "./name-pools";
import { GLOBAL_TEMPLATES, getGlobalTemplate } from "../../app/domain/drills/library";
import type { DemoCredential } from "./credentials";

export type SqlArg = string | number | null;
export interface SqlStatement {
  sql: string;
  args: SqlArg[];
}

export interface GeneratedSeed {
  /** DELETEs in FK-safe order — children before parents. */
  wipeStatements: SqlStatement[];
  /** INSERTs in FK-safe order — parents before children. */
  seedStatements: SqlStatement[];
}

// ---------- xorshift32 PRNG ----------

class Rng {
  private state: number;
  constructor(seed: number) {
    // xorshift requires non-zero state.
    this.state = seed === 0 ? 1 : seed >>> 0;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.next() % arr.length];
  }
  intBetween(lo: number, hi: number): number {
    return lo + (this.next() % Math.max(1, hi - lo + 1));
  }
}

// ---------- ID builders (stable, deterministic) ----------

function userIdFor(orgId: string, role: "admin" | "controller"): string {
  return `usr_demo_${orgId.replace(/^org_demo_/, "")}_${role}`;
}
function accountIdFor(orgId: string, role: "admin" | "controller"): string {
  return `acc_demo_${orgId.replace(/^org_demo_/, "")}_${role}`;
}
function appSettingsIdFor(orgId: string): string {
  return `aps_demo_${orgId.replace(/^org_demo_/, "")}`;
}
function householdIdFor(orgId: string, n: number): string {
  return `hh_demo_${orgId.replace(/^org_demo_/, "")}_${n.toString().padStart(4, "0")}`;
}
function templateIdFor(orgId: string, globalKey: string): string {
  return `dt_demo_${orgId.replace(/^org_demo_/, "")}_${globalKey}`;
}
function runIdFor(orgId: string, globalKey: string, n: number): string {
  return `dr_demo_${orgId.replace(/^org_demo_/, "")}_${globalKey}_${n}`;
}
function programIdFor(orgId: string, n: number): string {
  return `prog_demo_${orgId.replace(/^org_demo_/, "")}_${n.toString().padStart(2, "0")}`;
}

// ---------- Public entry points (signatures only — Task 5 fills in) ----------

export async function generate(
  specs: readonly DemoTenantSpec[],
  credentials: readonly DemoCredential[],
  /** Deterministic "now" — pass new Date() in production. */
  now: Date = new Date(),
): Promise<GeneratedSeed> {
  const wipeStatements: SqlStatement[] = [];
  const seedStatements: SqlStatement[] = [];

  // Wipe order: child tables first, then Org last. Same order as
  // e2e/fixtures/seeded-tenant.ts teardownSeedRows.
  for (const spec of specs) {
    wipeStatements.push(...buildWipe(spec.orgId));
  }

  // Pair each spec with its credential row by slug.
  const credBySlug = new Map(credentials.map((c) => [c.slug, c]));
  for (const spec of specs) {
    const cred = credBySlug.get(spec.slug);
    if (!cred) throw new Error(`No credential for ${spec.slug}`);
    seedStatements.push(...(await buildSeedForOrg(spec, cred, now)));
  }

  return { wipeStatements, seedStatements };
}

function buildWipe(orgId: string): SqlStatement[] {
  // Child-first ordering. Mirrors the shape used in
  // e2e/fixtures/seeded-tenant.ts teardownSeedRows but adds the demo-
  // specific tables (DrillRun, DrillTemplate, Household, ...). Order is
  // load-bearing — DrillRun → DrillTemplate, Student → Household, etc.
  const t = (table: string): SqlStatement => ({
    sql: `DELETE FROM "${table}" WHERE orgId = ?`,
    args: [orgId],
  });
  return [
    t("CallEvent"),
    t("DismissalException"),
    t("ProgramCancellation"),
    t("AfterSchoolProgram"),
    t("DrillRun"),
    t("DrillTemplate"),
    t("Student"),
    t("Household"),
    t("Space"),
    t("Teacher"),
    t("ViewerAccessAttempt"),
    t("ViewerAccessSession"),
    t("ViewerMagicLink"),
    t("AppSettings"),
    t("OrgAuditLog"),
    {
      sql: `DELETE FROM "Session" WHERE userId IN (SELECT id FROM "User" WHERE orgId = ?)`,
      args: [orgId],
    },
    {
      sql: `DELETE FROM "Account" WHERE userId IN (SELECT id FROM "User" WHERE orgId = ?)`,
      args: [orgId],
    },
    {
      sql: `DELETE FROM "User" WHERE orgId = ?`,
      args: [orgId],
    },
    {
      sql: `DELETE FROM "Org" WHERE id = ?`,
      args: [orgId],
    },
  ];
}

async function buildSeedForOrg(
  _spec: DemoTenantSpec,
  _cred: DemoCredential,
  _now: Date,
): Promise<SqlStatement[]> {
  // Filled in Task 5.
  throw new Error("buildSeedForOrg not implemented yet");
}
```

- [ ] **Step 2: Verify the file typechecks (no exec yet)**

Run: `npx tsc --noEmit scripts/demo-data/generate.ts`
Expected: no errors. (If `tsc` complains about the `require` in credentials.ts, change it to `import { createHash } from "node:crypto"` at the top of that file and re-typecheck.)

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-data/generate.ts
git commit -m "feat(demo-data): generator scaffolding + wipe SQL"
```

---

## Task 5: Implement `buildSeedForOrg` (parents → children inserts)

**Files:**
- Modify: `scripts/demo-data/generate.ts` (replace the stub `buildSeedForOrg`)

The full insert pipeline for one org. Follow this order strictly — every later step references rows created earlier:

1. `Org`
2. `AppSettings` (one row per org; viewerPinHash set so the public board's PIN gate works in the demo)
3. `User` × 2 (admin + controller) and `Account` × 2 (credential password rows). No `Session` — operators sign in via /login like a real user, so the demo does not pre-create sessions (avoids cookie-vs-host mismatch).
4. `Teacher` × `classroomCount` (homeRoom names from `TEACHER_LAST_NAMES`)
5. `Space` × ~`min(classroomCount * 3, 60)` car-line spaces (numbered 1..N)
6. `Household` × `householdCount`
7. `Student` × `studentCount`, each assigned to a teacher (round-robin), some grouped into households (siblings)
8. `DrillTemplate` × len(DEMO_DRILL_GLOBAL_KEYS), cloned from the global library
9. `DrillRun` × len(HISTORICAL_RUN_KEYS) per template, status=ENDED, with realistic toggles
10. `AfterSchoolProgram` × `programCount`
11. `ProgramCancellation` × 1–2 (next 7 days, tied to the first program)
12. `DismissalException` × 3–5 (today + this week)
13. `CallEvent` × `pastCallEvents` spread across the trailing 21 days

- [ ] **Step 1: Implement `buildSeedForOrg`**

```ts
// Replace the stub buildSeedForOrg in scripts/demo-data/generate.ts.

async function buildSeedForOrg(
  spec: DemoTenantSpec,
  cred: DemoCredential,
  now: Date,
): Promise<SqlStatement[]> {
  const out: SqlStatement[] = [];
  const rng = new Rng(spec.randomSeed);
  const nowIso = now.toISOString();

  // Pre-compute hashed values (PBKDF2 — same params as
  // app/domain/auth/better-auth.server.ts).
  const passwordHash = await hashPassword(cred.password);
  // Demo PIN is the last 4 digits of the org's randomSeed, padded.
  const viewerPin = (spec.randomSeed % 10000).toString().padStart(4, "0");
  const viewerPinHash = await hashPassword(viewerPin);

  // 1. Org
  out.push({
    sql: `INSERT INTO "Org" (id, name, slug, brandColor, brandAccentColor, status, billingPlan, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    args: [
      spec.orgId,
      spec.name,
      spec.slug,
      spec.brandColor,
      spec.brandAccentColor,
      spec.plan,
      nowIso,
      nowIso,
    ],
  });

  // 2. AppSettings (one row per org, primary key = orgId).
  out.push({
    sql: `INSERT INTO "AppSettings" (orgId, viewerDrawingEnabled, viewerPinHash)
          VALUES (?, 0, ?)`,
    args: [spec.orgId, viewerPinHash],
  });

  // 3. Users + credential Accounts (admin + controller).
  for (const role of ["admin", "controller"] as const) {
    const userId = userIdFor(spec.orgId, role);
    const email = role === "admin" ? cred.adminEmail : cred.controllerEmail;
    const dbRole = role === "admin" ? "ADMIN" : "CONTROLLER";
    out.push({
      sql: `INSERT INTO "User" (id, email, name, role, emailVerified, mustChangePassword, orgId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)`,
      args: [
        userId,
        email,
        role === "admin" ? `Demo Admin (${spec.slug})` : `Demo Controller (${spec.slug})`,
        dbRole,
        spec.orgId,
        nowIso,
        nowIso,
      ],
    });
    out.push({
      sql: `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      args: [
        accountIdFor(spec.orgId, role),
        email, // accountId is the email for credential provider per better-auth
        userId,
        passwordHash,
        nowIso,
        nowIso,
      ],
    });
  }

  // 4. Teachers (homerooms). Pick `classroomCount` distinct names from
  // TEACHER_LAST_NAMES, rotated by teacherLastNamesSeed so different orgs
  // don't all start with "Atwood".
  const homerooms: string[] = [];
  const startIdx = spec.teacherLastNamesSeed % TEACHER_LAST_NAMES.length;
  for (let i = 0; i < spec.classroomCount; i++) {
    const name = TEACHER_LAST_NAMES[(startIdx + i) % TEACHER_LAST_NAMES.length];
    // Ensure uniqueness within an org: append a grade when we wrap.
    const wrapped = i >= TEACHER_LAST_NAMES.length;
    const homeRoom = wrapped ? `${name} ${Math.floor(i / TEACHER_LAST_NAMES.length) + 1}` : name;
    homerooms.push(homeRoom);
    out.push({
      sql: `INSERT INTO "Teacher" (homeRoom, orgId) VALUES (?, ?)`,
      args: [homeRoom, spec.orgId],
    });
  }

  // 5. Spaces. Three per classroom, capped at 60. Numbered 1..N.
  const spaceCount = Math.min(spec.classroomCount * 3, 60);
  for (let n = 1; n <= spaceCount; n++) {
    out.push({
      sql: `INSERT INTO "Space" (spaceNumber, status, orgId) VALUES (?, 'EMPTY', ?)`,
      args: [n, spec.orgId],
    });
  }

  // 6. Households.
  const householdIds: string[] = [];
  for (let h = 0; h < spec.householdCount; h++) {
    const familyLast = LAST_NAMES[(spec.randomSeed + h) % LAST_NAMES.length];
    const id = householdIdFor(spec.orgId, h);
    householdIds.push(id);
    out.push({
      sql: `INSERT INTO "Household" (id, orgId, name, primaryContactName, primaryContactPhone, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        spec.orgId,
        `${familyLast} family`,
        `${rng.pick(FIRST_NAMES)} ${familyLast}`,
        `555-01${(h % 100).toString().padStart(2, "0")}`,
        nowIso,
        nowIso,
      ],
    });
  }

  // 7. Students. Round-robin homerooms; assign to households such that
  // ~30% of households have 2 children (siblings) and the rest have 1.
  // Assign every Nth student a spaceNumber (so the demo board has cars
  // already on it when a viewer first hits /).
  let nextHousehold = 0;
  let pending = 0; // how many students this household still wants
  for (let s = 0; s < spec.studentCount; s++) {
    if (pending <= 0) {
      // Pick a fresh household; with 30% odds it gets 2 students.
      nextHousehold = (nextHousehold + 1) % householdIds.length;
      pending = rng.next() % 10 < 3 ? 2 : 1;
    }
    const householdId = householdIds[nextHousehold];
    pending -= 1;

    const first = rng.pick(FIRST_NAMES);
    const last = LAST_NAMES[(spec.randomSeed + nextHousehold) % LAST_NAMES.length];
    const homeRoom = homerooms[s % homerooms.length];
    // Pre-position one student per active space (first `spaceCount`
    // students get sequential spaces; the rest are unassigned).
    const spaceNumber = s < spaceCount ? s + 1 : null;
    out.push({
      sql: `INSERT INTO "Student" (firstName, lastName, orgId, homeRoom, householdId, spaceNumber)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [first, last, spec.orgId, homeRoom, householdId, spaceNumber],
    });
  }

  // 8. DrillTemplates (clone subset of global library).
  for (const key of DEMO_DRILL_GLOBAL_KEYS) {
    const tpl = getGlobalTemplate(key);
    if (!tpl) throw new Error(`Global template missing: ${key}`);
    out.push({
      sql: `INSERT INTO "DrillTemplate" (id, orgId, name, drillType, authority, instructions, globalKey, definition, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        templateIdFor(spec.orgId, key),
        spec.orgId,
        tpl.name,
        tpl.drillType,
        tpl.authority,
        tpl.instructions,
        tpl.globalKey,
        JSON.stringify(tpl.definition),
        nowIso,
        nowIso,
      ],
    });
  }

  // 9. Historical DrillRuns (status=ENDED). One per HISTORICAL_RUN_KEYS,
  // dated 14 and 28 days ago so they appear in the recent runs list.
  for (let i = 0; i < HISTORICAL_RUN_KEYS.length; i++) {
    const key = HISTORICAL_RUN_KEYS[i];
    const tpl = getGlobalTemplate(key);
    if (!tpl) throw new Error(`Global template missing for historical run: ${key}`);
    const runDaysAgo = (i + 1) * 14;
    const startedAt = new Date(now.getTime() - runDaysAgo * 24 * 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + 12 * 60 * 1000); // 12 min run

    // Build a partial RunState: mark every toggle column on every row
    // as "positive" for ~80% of rows; rest left blank. This makes the
    // historical run look realistic in the print/replay views.
    const toggles: Record<string, "positive" | "negative"> = {};
    let rowIdx = 0;
    for (const row of tpl.definition.rows) {
      const include = rowIdx % 5 !== 0; // skip every 5th row (~80%)
      if (include) {
        for (const col of tpl.definition.columns) {
          if (col.kind === "toggle") {
            toggles[`${row.id}:${col.id}`] = "positive";
          }
        }
      }
      rowIdx++;
    }
    const state = { toggles, notes: `Demo replay — ${tpl.name}.`, actionItems: [] };

    out.push({
      sql: `INSERT INTO "DrillRun" (id, orgId, templateId, state, status, activatedAt, endedAt, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'ENDED', ?, ?, ?, ?)`,
      args: [
        runIdFor(spec.orgId, key, 1),
        spec.orgId,
        templateIdFor(spec.orgId, key),
        JSON.stringify(state),
        startedAt.toISOString(),
        endedAt.toISOString(),
        startedAt.toISOString(),
        endedAt.toISOString(),
      ],
    });
  }

  // 10. After-school programs.
  for (let p = 0; p < spec.programCount; p++) {
    const name = PROGRAM_NAMES[p % PROGRAM_NAMES.length];
    out.push({
      sql: `INSERT INTO "AfterSchoolProgram" (id, orgId, name, isActive, createdAt, updatedAt)
            VALUES (?, ?, ?, 1, ?, ?)`,
      args: [programIdFor(spec.orgId, p), spec.orgId, name, nowIso, nowIso],
    });
  }

  // 11. Program cancellation (next program-day, first program). Used by
  // the homepage banner. 1 cancellation per org keeps things visible
  // without spamming.
  if (spec.programCount > 0) {
    const cancelDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    cancelDate.setUTCHours(15, 0, 0, 0);
    out.push({
      sql: `INSERT INTO "ProgramCancellation" (id, orgId, programId, cancellationDate, title, message, deliveryMode, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 'IN_APP', ?, ?)`,
      args: [
        `pc_demo_${spec.orgId.replace(/^org_demo_/, "")}_01`,
        spec.orgId,
        programIdFor(spec.orgId, 0),
        cancelDate.toISOString(),
        `${PROGRAM_NAMES[0]} cancelled this Wednesday`,
        "Coach is out sick. We will resume next week — thanks for understanding!",
        nowIso,
        nowIso,
      ],
    });
  }

  // 12. Dismissal exceptions — 3 today/this week. Vary scheduleKind so
  // the dismissal-day-checklist demo shows both DATE and WEEKLY rows.
  // (studentId = null so we don't have to chase autoincrement IDs;
  // householdId references a stable household id.)
  for (let e = 0; e < Math.min(3, householdIds.length); e++) {
    const isWeekly = e % 2 === 0;
    const exceptionDate = new Date(now.getTime() + e * 24 * 60 * 60 * 1000);
    const scheduleKind = isWeekly ? "WEEKLY" : "DATE";
    out.push({
      sql: `INSERT INTO "DismissalException" (id, orgId, householdId, scheduleKind, exceptionDate, dayOfWeek, dismissalPlan, pickupContactName, isActive, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [
        `de_demo_${spec.orgId.replace(/^org_demo_/, "")}_${e.toString().padStart(2, "0")}`,
        spec.orgId,
        householdIds[e],
        scheduleKind,
        isWeekly ? null : exceptionDate.toISOString(),
        isWeekly ? exceptionDate.getUTCDay() : null,
        isWeekly ? "Walker (every Wednesday)" : "Aunt picking up — silver Subaru",
        isWeekly ? "Parent (recurring)" : "Maya Patel",
        nowIso,
        nowIso,
      ],
    });
  }

  // 13. Past CallEvents — pastCallEvents spread over trailing 21 days,
  // bunched into the 14:30–15:15 UTC dismissal window. studentId = null
  // (autoincrement student ids aren't pre-known); studentName uses a
  // synthesized "First Last" from the pools so /admin/history reads
  // realistically.
  for (let c = 0; c < spec.pastCallEvents; c++) {
    const minutesAgo =
      rng.intBetween(0, 21) * 24 * 60 + // 0..21 days
      rng.intBetween(870, 915); // 14:30..15:15 of that day (UTC minutes)
    const at = new Date(now.getTime() - minutesAgo * 60 * 1000);
    const studentName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    const homeRoom = homerooms[c % homerooms.length];
    const spaceNumber = (c % spaceCount) + 1;
    out.push({
      sql: `INSERT INTO "CallEvent" (orgId, spaceNumber, studentName, homeRoomSnapshot, createdAt)
            VALUES (?, ?, ?, ?, ?)`,
      args: [spec.orgId, spaceNumber, studentName, homeRoom, at.toISOString()],
    });
  }

  return out;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit scripts/demo-data/generate.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-data/generate.ts
git commit -m "feat(demo-data): implement per-org row construction"
```

---

## Task 6: Tests for the generator

**Files:**
- Create: `scripts/demo-data/generate.test.ts`
- Modify: `package.json` (`test` script — add new path glob)

The tests are pure: they call `generate()` against the real specs and assert structural properties. No DB.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/demo-data/generate.test.ts
//
// Pure tests — no DB. Asserts structural invariants of the generator:
//   - Output is deterministic (two runs produce identical SQL+args)
//   - Wipe runs strictly before any seed insert (FK-safe ordering)
//   - Every demo orgId appears in the wipe block
//   - Plan caps are respected (no spec exceeds CAR_LINE/CAMPUS limits)

import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "./generate";
import { DEMO_TENANTS } from "./specs";
import { resolveCredentials } from "./credentials";
import { PLAN_LIMITS } from "../../app/lib/plan-limits";

const FIXED_NOW = new Date("2026-04-25T15:00:00.000Z");
const FIXED_ENV = {
  DEMO_PASSWORD_SEED: "test-seed-do-not-deploy",
};

test("generate is deterministic given the same now + env", async () => {
  const credsA = resolveCredentials(DEMO_TENANTS, FIXED_ENV as NodeJS.ProcessEnv);
  const credsB = resolveCredentials(DEMO_TENANTS, FIXED_ENV as NodeJS.ProcessEnv);
  const a = await generate(DEMO_TENANTS, credsA, FIXED_NOW);
  const b = await generate(DEMO_TENANTS, credsB, FIXED_NOW);
  assert.equal(a.wipeStatements.length, b.wipeStatements.length);
  assert.equal(a.seedStatements.length, b.seedStatements.length);
  for (let i = 0; i < a.seedStatements.length; i++) {
    assert.equal(a.seedStatements[i].sql, b.seedStatements[i].sql);
    assert.deepEqual(a.seedStatements[i].args, b.seedStatements[i].args);
  }
});

test("wipe deletes children before parents (FK order)", async () => {
  const creds = resolveCredentials(DEMO_TENANTS, FIXED_ENV as NodeJS.ProcessEnv);
  const out = await generate(DEMO_TENANTS, creds, FIXED_NOW);
  // For each org, "Org" delete must come AFTER "User" delete which must
  // come after "Session" / "Account" deletes. Build positions per orgId.
  for (const spec of DEMO_TENANTS) {
    const positions = new Map<string, number>();
    out.wipeStatements.forEach((stmt, idx) => {
      // Track only statements whose args mention this orgId.
      if (stmt.args.includes(spec.orgId)) {
        const m = stmt.sql.match(/DELETE FROM "(\w+)"/);
        if (m) positions.set(m[1], idx);
      }
    });
    const orgPos = positions.get("Org");
    const userPos = positions.get("User");
    const accPos = positions.get("Account");
    assert.ok(orgPos !== undefined && userPos !== undefined && accPos !== undefined);
    assert.ok(accPos < userPos, "Account deleted before User");
    assert.ok(userPos < orgPos, "User deleted before Org");
  }
});

test("seed inserts Org before Users", async () => {
  const creds = resolveCredentials(DEMO_TENANTS, FIXED_ENV as NodeJS.ProcessEnv);
  const out = await generate(DEMO_TENANTS, creds, FIXED_NOW);
  for (const spec of DEMO_TENANTS) {
    const orgIdx = out.seedStatements.findIndex(
      (s) => /INSERT INTO "Org"/.test(s.sql) && s.args.includes(spec.orgId),
    );
    const userIdx = out.seedStatements.findIndex(
      (s) =>
        /INSERT INTO "User"/.test(s.sql) &&
        s.args.includes(spec.orgId),
    );
    assert.ok(orgIdx >= 0 && userIdx >= 0);
    assert.ok(orgIdx < userIdx, `Org insert (${orgIdx}) must precede User insert (${userIdx}) for ${spec.slug}`);
  }
});

test("CAR_LINE / CAMPUS specs stay under plan caps", () => {
  for (const spec of DEMO_TENANTS) {
    if (spec.plan === "CAR_LINE" || spec.plan === "CAMPUS") {
      const cap = PLAN_LIMITS[spec.plan];
      assert.ok(spec.studentCount <= cap.students, `${spec.slug}: students ${spec.studentCount} > cap ${cap.students}`);
      assert.ok(spec.householdCount <= cap.families, `${spec.slug}: families ${spec.householdCount} > cap ${cap.families}`);
      assert.ok(spec.classroomCount <= cap.classrooms, `${spec.slug}: classrooms ${spec.classroomCount} > cap ${cap.classrooms}`);
    }
  }
});

test("every demo org has at least one Org and one Account in the seed", async () => {
  const creds = resolveCredentials(DEMO_TENANTS, FIXED_ENV as NodeJS.ProcessEnv);
  const out = await generate(DEMO_TENANTS, creds, FIXED_NOW);
  for (const spec of DEMO_TENANTS) {
    const hasOrg = out.seedStatements.some(
      (s) => /INSERT INTO "Org"/.test(s.sql) && s.args.includes(spec.orgId),
    );
    const hasAccount = out.seedStatements.some(
      (s) => /INSERT INTO "Account"/.test(s.sql) && s.args.some((a) => typeof a === "string" && a.startsWith("acc_demo_")),
    );
    assert.ok(hasOrg, `${spec.slug}: missing Org insert`);
    assert.ok(hasAccount, `${spec.slug}: missing Account insert`);
  }
});
```

- [ ] **Step 2: Add the new path to package.json `test` script**

Edit `package.json`:

```json
"test": "tsx --test app/domain/billing/*.test.ts app/domain/utils/*.test.ts app/lib/*.test.ts app/domain/drills/*.test.ts app/domain/csv/*.test.ts app/domain/auth/*.test.ts scripts/demo-data/*.test.ts",
```

- [ ] **Step 3: Run the tests, verify they pass**

Run: `npm test`
Expected: all suites pass, including the 5 new `generate.test.ts` cases.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-data/generate.test.ts package.json
git commit -m "test(demo-data): generator determinism + ordering"
```

---

## Task 7: libsql applier (local dev.db)

**Files:**
- Create: `scripts/demo-data/apply-libsql.ts`

- [ ] **Step 1: Implement the libsql applier**

```ts
// scripts/demo-data/apply-libsql.ts
//
// Apply generated SQL statements to a libsql-compatible database
// (the local file:./dev.db, or any URL accepted by @libsql/client).
//
// libsql supports `client.batch(stmts, "write")` which gives us a single
// implicit transaction — perfect for "wipe + seed" semantics. If the
// batch fails halfway through, no rows are left behind.

import { createClient } from "@libsql/client";
import type { GeneratedSeed } from "./generate";

export async function applyLibsql(
  databaseUrl: string,
  seed: GeneratedSeed,
): Promise<{ wiped: number; seeded: number }> {
  const db = createClient({ url: databaseUrl });
  try {
    // Wipe and seed in a single batch so the demo orgs are never
    // half-deleted (a partial failure would leave the local DB
    // unable to re-seed cleanly).
    const all = [...seed.wipeStatements, ...seed.seedStatements].map((s) => ({
      sql: s.sql,
      args: s.args,
    }));
    await db.batch(all, "write");
    return {
      wiped: seed.wipeStatements.length,
      seeded: seed.seedStatements.length,
    };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/demo-data/apply-libsql.ts
git commit -m "feat(demo-data): libsql applier for local dev.db"
```

---

## Task 8: SQL emitter (for `wrangler d1 execute --file`)

**Files:**
- Create: `scripts/demo-data/emit-sql.ts`

D1 cannot accept parameterized statements via `wrangler d1 execute --file`, so we serialise args into the SQL with proper quoting. The emitter handles strings (single-quote escape), numbers, and `null`. We don't accept any other type — the generator only ever produces these three.

- [ ] **Step 1: Implement emit-sql.ts**

```ts
// scripts/demo-data/emit-sql.ts
//
// Serialise GeneratedSeed → a single .sql file suitable for
// `wrangler d1 execute --remote --file=...`. Args are inlined because
// `wrangler d1 execute` does not support `--bind` for file mode.
//
// SECURITY NOTE: every arg comes from our own deterministic generator —
// there is no untrusted input here. Even so, we use a strict allowlist
// (string|number|null) and a single-quote-doubling escape so the file
// can never inadvertently introduce a malformed statement.

import type { GeneratedSeed, SqlArg } from "./generate";

function quote(arg: SqlArg): string {
  if (arg === null) return "NULL";
  if (typeof arg === "number") {
    if (!Number.isFinite(arg)) {
      throw new Error(`emit-sql: non-finite numeric arg ${arg}`);
    }
    return arg.toString();
  }
  if (typeof arg === "string") {
    return `'${arg.replace(/'/g, "''")}'`;
  }
  // The SqlArg type forbids everything else; this throw is belt-and-
  // suspenders so a future widening of SqlArg surfaces here loudly.
  throw new Error(`emit-sql: unsupported arg type ${typeof arg}`);
}

function inline(sql: string, args: SqlArg[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    if (i >= args.length) {
      throw new Error(`emit-sql: not enough args for sql: ${sql}`);
    }
    return quote(args[i++]);
  });
}

export function emitSql(seed: GeneratedSeed): string {
  const lines: string[] = [];
  lines.push("-- Auto-generated by scripts/demo-data/emit-sql.ts");
  lines.push("-- Do not edit by hand. Re-run: npm run demo:seed:<env>.");
  lines.push("BEGIN;");
  lines.push("-- WIPE");
  for (const s of seed.wipeStatements) {
    lines.push(inline(s.sql, s.args) + ";");
  }
  lines.push("-- SEED");
  for (const s of seed.seedStatements) {
    lines.push(inline(s.sql, s.args) + ";");
  }
  lines.push("COMMIT;");
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 2: Add a quick unit test for the emitter**

Append to `scripts/demo-data/generate.test.ts`:

```ts
import { emitSql } from "./emit-sql";

test("emitSql escapes single quotes and renders NULL", () => {
  const sql = emitSql({
    wipeStatements: [],
    seedStatements: [
      { sql: `INSERT INTO "T" (a, b, c) VALUES (?, ?, ?)`, args: ["O'Brien", 42, null] },
    ],
  });
  assert.match(sql, /VALUES \('O''Brien', 42, NULL\)/);
});

test("emitSql throws on arg-count mismatch", () => {
  assert.throws(() =>
    emitSql({
      wipeStatements: [],
      seedStatements: [{ sql: `INSERT INTO "T" VALUES (?, ?)`, args: ["x"] }],
    }),
  );
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-data/emit-sql.ts scripts/demo-data/generate.test.ts
git commit -m "feat(demo-data): emit single-file SQL for wrangler d1"
```

---

## Task 9: CLI entry point (`scripts/seed-demo-tenants.ts`)

**Files:**
- Create: `scripts/seed-demo-tenants.ts`

- [ ] **Step 1: Implement the CLI**

```ts
// scripts/seed-demo-tenants.ts
//
// Usage:
//   tsx scripts/seed-demo-tenants.ts --target=local
//   tsx scripts/seed-demo-tenants.ts --target=remote --env=staging --out=demo-seed.staging.sql
//   tsx scripts/seed-demo-tenants.ts --target=remote --env=production --out=demo-seed.prod.sql
//   tsx scripts/seed-demo-tenants.ts --wipe-only --target=local
//
// `--target=local` writes directly to DATABASE_URL (default file:./dev.db).
// `--target=remote` writes a SQL file you then apply with:
//   wrangler d1 execute school-organizer-staging --remote --env=staging --file=demo-seed.staging.sql
//   wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql
//
// The npm scripts wire these two steps together. See package.json.

import { promises as fs } from "node:fs";
import { DEMO_TENANTS } from "./demo-data/specs";
import { generate, type GeneratedSeed } from "./demo-data/generate";
import { applyLibsql } from "./demo-data/apply-libsql";
import { emitSql } from "./demo-data/emit-sql";
import { resolveCredentials, printSummary } from "./demo-data/credentials";

interface Args {
  target: "local" | "remote";
  out?: string;
  wipeOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: "local", wipeOnly: false };
  for (const a of argv) {
    if (a === "--wipe-only") args.wipeOnly = true;
    else if (a.startsWith("--target=")) {
      const v = a.slice("--target=".length);
      if (v !== "local" && v !== "remote") {
        throw new Error(`--target must be local|remote, got ${v}`);
      }
      args.target = v;
    } else if (a.startsWith("--out=")) {
      args.out = a.slice("--out=".length);
    } else if (a.startsWith("--env=")) {
      // Accepted but unused — present so the npm scripts can pass it
      // through transparently. The actual env binding happens at the
      // wrangler step.
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (args.target === "remote" && !args.out) {
    args.out = "demo-seed.sql";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const creds = resolveCredentials(DEMO_TENANTS);
  const seed = await generate(DEMO_TENANTS, creds, new Date());

  // For --wipe-only, drop the seed half so we only delete demo rows.
  const effective: GeneratedSeed = args.wipeOnly
    ? { wipeStatements: seed.wipeStatements, seedStatements: [] }
    : seed;

  if (args.target === "local") {
    const url = process.env.DATABASE_URL ?? "file:./dev.db";
    const result = await applyLibsql(url, effective);
    console.log(`✓ Local seed applied to ${url}: wiped ${result.wiped}, seeded ${result.seeded}.`);
    if (!args.wipeOnly) printSummary(creds);
    return;
  }

  // Remote: write file. Apply via wrangler externally (see npm scripts).
  if (!args.out) throw new Error("--out is required for --target=remote");
  const sql = emitSql(effective);
  await fs.writeFile(args.out, sql, "utf8");
  console.log(`✓ Wrote ${sql.length.toLocaleString()} bytes to ${args.out}.`);
  console.log(`  Apply it with: wrangler d1 execute <db> --remote [--env <env>] --file=${args.out}`);
  if (!args.wipeOnly) printSummary(creds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test against local dev.db**

Run: `npx tsx scripts/seed-demo-tenants.ts --target=local`
Expected output (sample):
```
✓ Local seed applied to file:./dev.db: wiped 95, seeded ~3500.

=== Demo tenant credentials ===
  bhs-example  [generated from DEMO_PASSWORD_SEED]
    admin: admin@bhs-example.demo
    ...
```

Then verify rows landed:
```bash
sqlite3 dev.db 'SELECT slug, billingPlan FROM "Org" WHERE id LIKE "org_demo_%"'
```
Expected: 5 rows (bhs-example, lincoln-example, westside-elem-example, westside-middle-example, westside-hs-example).

- [ ] **Step 3: Smoke-test re-runnability**

Run: `npx tsx scripts/seed-demo-tenants.ts --target=local` (a second time)
Expected: same `✓` line, no UNIQUE constraint errors. Row counts unchanged.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo-tenants.ts
git commit -m "feat(scripts): demo-tenants CLI"
```

---

## Task 10: package.json scripts

**Files:**
- Modify: `package.json`

Add four scripts:
- `demo:seed:local` — apply directly to dev.db
- `demo:seed:staging` — emit + execute against staging D1
- `demo:seed:prod` — emit + execute against prod D1 (chained with a manual confirmation prompt — operator pastes the printed `wrangler d1 execute` invocation)
- `demo:seed:wipe:local` — wipe-only against dev.db

We deliberately do NOT chain the wrangler command for prod automatically — running destructive SQL against production should be a deliberate copy/paste, not a one-keystroke npm run.

- [ ] **Step 1: Edit package.json**

Inside `"scripts"`, add (after `"backfill:org-id"`):

```json
"demo:seed:local": "tsx scripts/seed-demo-tenants.ts --target=local",
"demo:seed:wipe:local": "tsx scripts/seed-demo-tenants.ts --target=local --wipe-only",
"demo:seed:staging": "tsx scripts/seed-demo-tenants.ts --target=remote --env=staging --out=demo-seed.staging.sql && wrangler d1 execute school-organizer-staging --remote --env=staging --file=demo-seed.staging.sql",
"demo:seed:prod:emit": "tsx scripts/seed-demo-tenants.ts --target=remote --env=production --out=demo-seed.prod.sql"
```

- [ ] **Step 2: Add `demo-seed.*.sql` to `.gitignore`**

Append to `.gitignore`:

```
# Generated by scripts/seed-demo-tenants.ts (--target=remote)
demo-seed.*.sql
```

- [ ] **Step 3: Verify the local script still works through npm**

Run: `npm run demo:seed:local`
Expected: same `✓ Local seed applied ...` output as before.

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore(demo-data): npm scripts + gitignore generated SQL"
```

---

## Task 11: Operator documentation

**Files:**
- Create: `docs/demo-tenants.md`

- [ ] **Step 1: Write the operator doc**

```markdown
# Demo tenants

This repo seeds five long-lived demo tenants for Loom recordings, marketing-page screenshots, and live demos:

| Slug                       | Plan     | Notes |
|----------------------------|----------|-------|
| `bhs-example`              | CAR_LINE | Mid-size single school. Default Loom subject. |
| `lincoln-example`          | CAMPUS   | Larger single school; advanced branding tier. |
| `westside-elem-example`    | DISTRICT | Sibling org #1 of the Westside district demo. |
| `westside-middle-example`  | DISTRICT | Sibling org #2. |
| `westside-hs-example`      | DISTRICT | Sibling org #3. |

The trio under `westside-*-example` is a placeholder for the in-flight district-aggregation work; today they are independent orgs with a shared brand palette.

## Running

The seeder is idempotent: every run wipes existing demo rows (matched by stable `org_demo_*` ids) and re-inserts.

### Local dev

```sh
npm run demo:seed:local
```

Defaults to `DATABASE_URL=file:./dev.db`. Pass `DATABASE_URL=...` to target a different libsql.

### Staging

```sh
npm run demo:seed:staging
```

Emits `demo-seed.staging.sql` then applies via `wrangler d1 execute --remote --env=staging`.

### Production

For safety the prod path is two-step:

```sh
npm run demo:seed:prod:emit                                                           # writes demo-seed.prod.sql
wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql               # apply (no --env flag)
```

Inspect `demo-seed.prod.sql` before applying. Look for: 5 `INSERT INTO "Org"` statements, expected slug suffixes (`-example`), and no rows referencing real-tenant ids.

### Wipe only

```sh
npm run demo:seed:wipe:local
```

Or for remote: re-emit with `--wipe-only` and apply.

## Credentials

Each org gets two users: an `admin@<slug>.demo` and a `controller@<slug>.demo`. Both share one password per org.

Password resolution order:
1. `DEMO_PASSWORD_<UPPER_SLUG_NO_SUFFIX>` (e.g. `DEMO_PASSWORD_BHS`, `DEMO_PASSWORD_WESTSIDE_ELEM`)
2. `DEMO_PASSWORD_DEFAULT`
3. Derived from `DEMO_PASSWORD_SEED` (sha256-truncated)

The script prints the resolved credentials at the end of every run. Save them out-of-band — they are not stored anywhere else.

## Updating the seeded data

To change roster sizes, brand colors, names, etc.: edit `scripts/demo-data/specs.ts`. Run tests (`npm test`) and then re-seed each environment. Stable ids mean a re-seed cleanly replaces the old rows.

To add a new demo tenant: append to `DEMO_TENANTS` in `specs.ts`, give it a unique `orgId` and `randomSeed`, and re-seed.

## What gets seeded per org

- 1 `Org` row (with brand colors + plan)
- 1 `AppSettings` row (viewer PIN hashed; PIN = last 4 digits of `randomSeed`)
- 2 `User` rows (ADMIN + CONTROLLER) and matching credential `Account` rows
- N `Teacher` rows (homerooms named after `TEACHER_LAST_NAMES`)
- ~3× classrooms `Space` rows (car-line spaces)
- N `Household` rows
- N `Student` rows, ~30% with siblings
- 5 cloned `DrillTemplate` rows (fire, lockdown, secure, severe weather, reunification)
- 2 historical `DrillRun` rows (status = ENDED) for replay
- N `AfterSchoolProgram` rows
- 1 `ProgramCancellation` (next program day)
- 3 `DismissalException` rows (mix of DATE + WEEKLY)
- N past `CallEvent` rows spread across the trailing 21 days

## Cron + billing interactions

Demo orgs have `billingPlan` set but no Stripe subscription, no `trialStartedAt`, and `status='ACTIVE'`. The trial-expiry cron (`workers/app.ts`) keys off `OrgStatus = 'TRIALING'`, so demo orgs are not pulled into the trial pipeline. Same for billing webhooks — these orgs cannot be touched by any Stripe event because they have no `stripeCustomerId`.

If the lifecycle email cron (`SentEmail`) ever sweeps `ACTIVE` orgs, demo orgs may receive emails — set the admin email's mailbox to a sink you own, or add an `isComped = 1` flag in a future iteration.
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo-tenants.md
git commit -m "docs(demo-tenants): operator guide"
```

---

## Task 12: End-to-end verification (local)

**Files:**
- (no code changes — verification only)

- [ ] **Step 1: Wipe + re-seed local**

Run: `npm run demo:seed:wipe:local && npm run demo:seed:local`
Expected: clean run, credentials printed.

- [ ] **Step 2: Verify the rows in dev.db**

Run:
```sh
sqlite3 dev.db <<'SQL'
SELECT slug, billingPlan,
  (SELECT COUNT(*) FROM "Student"  s WHERE s.orgId = o.id) AS students,
  (SELECT COUNT(*) FROM "Teacher"  t WHERE t.orgId = o.id) AS teachers,
  (SELECT COUNT(*) FROM "Space"    sp WHERE sp.orgId = o.id) AS spaces,
  (SELECT COUNT(*) FROM "DrillTemplate" dt WHERE dt.orgId = o.id) AS templates,
  (SELECT COUNT(*) FROM "DrillRun" dr WHERE dr.orgId = o.id) AS runs,
  (SELECT COUNT(*) FROM "CallEvent" ce WHERE ce.orgId = o.id) AS calls
FROM "Org" o WHERE o.id LIKE 'org_demo_%'
ORDER BY slug;
SQL
```
Expected: 5 rows; counts roughly match the spec (e.g. `bhs-example | CAR_LINE | 120 | 12 | 36 | 5 | 2 | 220`).

- [ ] **Step 3: Manual login smoke test**

Start `npm run dev:worker` and visit `http://bhs-example.localhost:8787`. Sign in with the printed admin email + password.

Expected:
- Login succeeds; redirect lands on the tenant board
- Board shows car-line spaces 1..36 with some active rows
- `/admin/dashboard` shows roster counts matching above
- `/admin/drills` shows 5 cloned templates and a "Recent runs" list with 2 ENDED runs
- `/admin/history` shows ~220 historical CallEvents across the trailing 21 days

If any of these are missing, return to the affected task before proceeding to staging/prod.

- [ ] **Step 4: Commit verification artefacts (only if you generated any)**

(No code change; nothing to commit unless something broke and required a fix.)

---

## Task 13: Apply to staging

**Files:**
- (no code changes — operational)

- [ ] **Step 1: Sanity-check the staging D1 binding**

Run: `npx wrangler d1 list | grep school-organizer-staging`
Expected: one row matching `database_id = fc7bcf62-c40f-474e-9bec-64dfd0bd1135` (per `wrangler.jsonc`).

- [ ] **Step 2: Set demo password env (optional but recommended)**

```sh
export DEMO_PASSWORD_SEED='<your-shared-team-secret>'
# or per-org:
export DEMO_PASSWORD_BHS='<strong-password-1>'
export DEMO_PASSWORD_LINCOLN='<strong-password-2>'
# etc.
```

- [ ] **Step 3: Emit + apply**

Run: `npm run demo:seed:staging`
Expected:
- `✓ Wrote N bytes to demo-seed.staging.sql`
- Wrangler executes the file, reporting "(N) command(s) executed successfully"
- Credentials block printed

- [ ] **Step 4: Manual login smoke test on staging**

Visit `https://bhs-example.<staging-host>` (e.g. `https://bhs-example.school-organizer-staging.sundbergne.workers.dev` if the wildcard route is available, or use the worker.dev URL directly with a `Host:` override during testing). Sign in with printed creds. Verify the same checks as Task 12 step 3.

- [ ] **Step 5: Delete the emitted SQL**

Run: `rm demo-seed.staging.sql`
(`.gitignore` covers it, but cleaning up keeps the worktree tidy.)

---

## Task 14: Apply to production (manual + careful)

**Files:**
- (no code changes — operational)

- [ ] **Step 1: Confirm prod D1 id**

Run: `npx wrangler d1 list | grep -E 'school-organizer\b'`
Expected: row matching `35284987-f919-47e9-884d-d2f921324352` (per `wrangler.jsonc`).

- [ ] **Step 2: Confirm no slug collisions**

Run:
```sh
npx wrangler d1 execute school-organizer --remote --command "SELECT slug FROM Org WHERE slug LIKE '%-example' OR id LIKE 'org_demo_%'"
```
If this returns any rows, they are leftovers from a prior run; the seeder's wipe will clean them safely. Note them anyway.

- [ ] **Step 3: Emit and inspect the SQL**

Run: `npm run demo:seed:prod:emit`
Open `demo-seed.prod.sql`. Verify by eye:
- File begins with `BEGIN;` and ends with `COMMIT;`
- 5 `INSERT INTO "Org"` lines, all with slugs ending in `-example`
- No reference to real production org slugs / ids
- Credentials block was printed to stdout (capture and save)

- [ ] **Step 4: Apply (deliberate copy/paste — not via npm script)**

Run: `npx wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql`

Wrangler prompts for confirmation since this writes to production — answer `yes`.

Expected: success message with command count.

- [ ] **Step 5: Smoke-test on production**

Visit `https://bhs-example.pickuproster.com`. Sign in. Spot-check `/admin/dashboard`, `/admin/drills`, `/admin/history`.

Expected: same checks as Task 12 step 3, on the real domain.

- [ ] **Step 6: Delete the emitted SQL and credentials log**

Run: `rm demo-seed.prod.sql`
Save credentials in your password manager.

- [ ] **Step 7: Open a follow-up task ticket**

When the in-flight district refactor lands, attach the `westside-*-example` orgs to the new district aggregation entity and update `scripts/demo-data/specs.ts` accordingly. The stable `districtKey: 'westside'` field on the spec is the hook.

---
