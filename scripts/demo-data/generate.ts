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
import { getGlobalTemplate } from "../../app/domain/drills/library";
import {
  adminEmailFor,
  controllerEmailFor,
  type DemoCredential,
} from "./credentials";

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
    return arr[this.next() % arr.length]!;
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

// ---------- Public entry points (Task 5 fills in buildSeedForOrg) ----------

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
  // Filled in Task 5. The following symbols are imported now so that
  // Task 5's diff is purely additive — adding row construction here
  // without also touching the import block.
  void hashPassword;
  void DEMO_DRILL_GLOBAL_KEYS;
  void HISTORICAL_RUN_KEYS;
  void FIRST_NAMES;
  void LAST_NAMES;
  void PROGRAM_NAMES;
  void TEACHER_LAST_NAMES;
  void getGlobalTemplate;
  void adminEmailFor;
  void controllerEmailFor;
  void Rng;
  void userIdFor;
  void accountIdFor;
  void appSettingsIdFor;
  void householdIdFor;
  void templateIdFor;
  void runIdFor;
  void programIdFor;
  throw new Error("buildSeedForOrg not implemented yet");
}
