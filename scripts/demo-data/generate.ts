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

import { hashPassword } from "../../app/domain/auth/password-hash";
import {
  DEMO_DISTRICTS,
  DEMO_DRILL_GLOBAL_KEYS,
  HISTORICAL_RUN_KEYS,
  type DemoDistrictSpec,
  type DemoTenantSpec,
} from "./specs";
import {
  FIRST_NAMES,
  LAST_NAMES,
  PROGRAM_NAMES,
  TEACHER_LAST_NAMES,
} from "./name-pools";
import { getGlobalTemplate } from "../../app/domain/drills/library";
import { type DemoCredential } from "./credentials";

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

// ---------- Demo-data tunables ----------

/** Hard cap on car-line spaces per org — even big schools rarely have more. */
const MAX_SPACES_PER_ORG = 60;
/** UTC minutes-of-day window for synthetic CallEvent timestamps (~14:30–15:15). */
const DISMISSAL_WINDOW_START_UTC_MIN = 14 * 60 + 30;
const DISMISSAL_WINDOW_END_UTC_MIN = 15 * 60 + 15;
/** How far back past CallEvents are scattered (days). */
const PAST_CALL_EVENTS_LOOKBACK_DAYS = 21;
/** Out of 10, the chance a household gets two students (siblings). */
const SIBLING_PROBABILITY_TENTHS = 3;
/** Day offsets for the historical DrillRun timestamps (one per HISTORICAL_RUN_KEYS). */
const DRILL_RUN_OFFSET_DAYS = 14;
/** Synthetic length of a historical drill run, in minutes. */
const HISTORICAL_DRILL_RUN_DURATION_MIN = 12;
/** Every Nth row in a historical drill run is intentionally left blank (=> ~80% completion). */
const HISTORICAL_DRILL_BLANK_EVERY_N = 5;

// ---------- ID builders (stable, deterministic) ----------

function userIdFor(orgId: string, role: "admin" | "controller"): string {
  return `usr_demo_${orgId.replace(/^org_demo_/, "")}_${role}`;
}
function accountIdFor(orgId: string, role: "admin" | "controller"): string {
  return `acc_demo_${orgId.replace(/^org_demo_/, "")}_${role}`;
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
function cancellationIdFor(orgId: string, n: number): string {
  return `pc_demo_${orgId.replace(/^org_demo_/, "")}_${n.toString().padStart(2, "0")}`;
}
function dismissalExceptionIdFor(orgId: string, n: number): string {
  return `de_demo_${orgId.replace(/^org_demo_/, "")}_${n.toString().padStart(2, "0")}`;
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

  // Wipe order: org-scoped child tables first, then Org, then District.
  // District is "above" Org in the FK graph (Org.districtId references
  // District.id, ON DELETE SET NULL). Deleting orgs first means the
  // district rows are unreferenced when we delete them.
  for (const spec of specs) {
    wipeStatements.push(...buildWipe(spec.orgId));
  }
  for (const d of DEMO_DISTRICTS) {
    wipeStatements.push(...buildDistrictWipe(d.districtId));
  }

  // Districts must be inserted BEFORE the orgs that reference them.
  for (const d of DEMO_DISTRICTS) {
    seedStatements.push(buildDistrictInsert(d, now));
  }

  // Index districts by key so each org can resolve its parent districtId.
  const districtIdByKey = new Map(
    DEMO_DISTRICTS.map((d) => [d.districtKey, d.districtId]),
  );

  // Pair each spec with its credential row by slug.
  const credBySlug = new Map(credentials.map((c) => [c.slug, c]));
  for (const spec of specs) {
    const cred = credBySlug.get(spec.slug);
    if (!cred) throw new Error(`No credential for ${spec.slug}`);
    const districtId = spec.districtKey
      ? districtIdByKey.get(spec.districtKey) ?? null
      : null;
    seedStatements.push(...(await buildSeedForOrg(spec, cred, now, districtId)));
  }

  return { wipeStatements, seedStatements };
}

function buildDistrictWipe(districtId: string): SqlStatement[] {
  // DistrictAuditLog cascades on District delete, but we delete it
  // explicitly anyway so the wipe shape is symmetric with the demo's
  // stable-id contract (every demo row deleted by its known id).
  return [
    {
      sql: `DELETE FROM "DistrictAuditLog" WHERE districtId = ?`,
      args: [districtId],
    },
    {
      sql: `DELETE FROM "District" WHERE id = ?`,
      args: [districtId],
    },
  ];
}

function buildDistrictInsert(d: DemoDistrictSpec, now: Date): SqlStatement {
  const nowIso = now.toISOString();
  // District has no brand-color columns (logo only) — we keep the colors
  // on the spec for symmetry with `DemoTenantSpec` and so the demo
  // district picks up the same palette as its member schools elsewhere
  // (e.g. a future District.brandColor migration). For now they're
  // metadata-only.
  return {
    sql: `INSERT INTO "District" (id, name, slug, status, billingPlan, schoolCap, createdAt, updatedAt)
          VALUES (?, ?, ?, 'ACTIVE', 'DISTRICT', 5, ?, ?)`,
    args: [d.districtId, d.name, d.slug, nowIso, nowIso],
  };
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
    // DrillRunEvent.runId → DrillRun has ON DELETE CASCADE, so wiping
    // DrillRun clears children automatically. We still emit an explicit
    // DELETE so the demo's stable-id contract is respected (every demo
    // row deleted by a known scope) and so the wipe block is symmetric
    // with the rest of the table list. Subquery-scope by orgId because
    // DrillRunEvent has no orgId column of its own.
    {
      sql: `DELETE FROM "DrillRunEvent" WHERE runId IN (SELECT id FROM "DrillRun" WHERE orgId = ?)`,
      args: [orgId],
    },
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
  spec: DemoTenantSpec,
  cred: DemoCredential,
  now: Date,
  districtId: string | null,
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

  // 1. Org. `districtId` is non-null only for member schools of a demo
  // district (e.g. the Westside trio). When set the Org appears under
  // that District in the platform admin panel and inherits district-
  // level billing.
  out.push({
    sql: `INSERT INTO "Org" (id, name, slug, brandColor, brandAccentColor, status, billingPlan, districtId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
    args: [
      spec.orgId,
      spec.name,
      spec.slug,
      spec.brandColor,
      spec.brandAccentColor,
      spec.plan,
      districtId,
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
  // TEACHER_LAST_NAMES, rotated by teacherNameOffset so different orgs
  // don't all start with "Atwood".
  const homerooms: string[] = [];
  const startIdx = spec.teacherNameOffset % TEACHER_LAST_NAMES.length;
  for (let i = 0; i < spec.classroomCount; i++) {
    const name = TEACHER_LAST_NAMES[(startIdx + i) % TEACHER_LAST_NAMES.length]!;
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
  const spaceCount = Math.min(spec.classroomCount * 3, MAX_SPACES_PER_ORG);
  for (let n = 1; n <= spaceCount; n++) {
    out.push({
      sql: `INSERT INTO "Space" (spaceNumber, status, orgId) VALUES (?, 'EMPTY', ?)`,
      args: [n, spec.orgId],
    });
  }

  // 6. Households.
  const householdIds: string[] = [];
  for (let h = 0; h < spec.householdCount; h++) {
    const familyLast = LAST_NAMES[(spec.randomSeed + h) % LAST_NAMES.length]!;
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
  if (spec.studentCount > 0 && householdIds.length === 0) {
    throw new Error(
      `Spec ${spec.slug}: studentCount > 0 requires at least one household`,
    );
  }
  let nextHousehold = -1;
  let pending = 0; // how many students this household still wants
  for (let s = 0; s < spec.studentCount; s++) {
    if (pending <= 0) {
      // Pick a fresh household; with 30% odds it gets 2 students.
      nextHousehold = (nextHousehold + 1) % householdIds.length;
      pending = rng.next() % 10 < SIBLING_PROBABILITY_TENTHS ? 2 : 1;
    }
    const householdId = householdIds[nextHousehold]!;
    pending -= 1;

    const first = rng.pick(FIRST_NAMES);
    const last = LAST_NAMES[(spec.randomSeed + nextHousehold) % LAST_NAMES.length]!;
    const homeRoom = homerooms[s % homerooms.length]!;
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
    const key = HISTORICAL_RUN_KEYS[i]!;
    const tpl = getGlobalTemplate(key);
    if (!tpl) throw new Error(`Global template missing for historical run: ${key}`);
    const runDaysAgo = (i + 1) * DRILL_RUN_OFFSET_DAYS;
    const startedAt = new Date(now.getTime() - runDaysAgo * 24 * 60 * 60 * 1000);
    const durationMs = HISTORICAL_DRILL_RUN_DURATION_MIN * 60 * 1000;
    const endedAt = new Date(startedAt.getTime() + durationMs);

    // Build a partial RunState: mark every toggle column on every row
    // as "positive" for ~80% of rows; rest left blank. This makes the
    // historical run look realistic in the print/replay views.
    const toggles: Record<string, "positive" | "negative"> = {};
    let rowIdx = 0;
    for (const row of tpl.definition.rows) {
      const include = rowIdx % HISTORICAL_DRILL_BLANK_EVERY_N !== 0;
      if (include) {
        for (const col of tpl.definition.columns) {
          if (col.kind === "toggle") {
            toggles[`${row.id}:${col.id}`] = "positive";
          }
        }
      }
      rowIdx++;
    }
    const notes = `Demo replay — ${tpl.name}.`;
    const state = { toggles, notes, actionItems: [] };

    const runId = runIdFor(spec.orgId, key, 1);
    const actorUserId = userIdFor(spec.orgId, "admin");

    out.push({
      sql: `INSERT INTO "DrillRun" (id, orgId, templateId, state, status, activatedAt, endedAt, lastActorUserId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'ENDED', ?, ?, ?, ?, ?)`,
      args: [
        runId,
        spec.orgId,
        templateIdFor(spec.orgId, key),
        JSON.stringify(state),
        startedAt.toISOString(),
        endedAt.toISOString(),
        actorUserId,
        startedAt.toISOString(),
        endedAt.toISOString(),
      ],
    });

    // Synthetic event log so /admin/drills/history/<runId> has a replay
    // timeline immediately after seeding. Pure SQL inserts, no
    // applyEvent reducer — keeps this generator dependency-light and
    // lets the demo SQL render identically across environments.
    //
    // Stable event IDs derived from spec.orgId + run key + index so a
    // re-run produces the same primary keys (the snapshot test relies
    // on this).
    const orgKey = spec.orgId.replace(/^org_demo_/, "");
    const eventIdFor = (n: number) => `evt_demo_${orgKey}_${key}_${n}`;
    const insertEvent = (
      n: number,
      occurredAt: Date,
      payload: Record<string, unknown>,
    ) => {
      out.push({
        sql: `INSERT INTO "DrillRunEvent" (id, runId, kind, payload, actorUserId, onBehalfOfUserId, occurredAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          eventIdFor(n),
          runId,
          payload.kind as string,
          JSON.stringify(payload),
          actorUserId,
          null,
          occurredAt.toISOString(),
        ],
      });
    };

    let eventIdx = 0;
    // 1. started — replay engine bootstraps from initialState.
    insertEvent(eventIdx++, startedAt, {
      kind: "started",
      initialState: { toggles: {}, notes: "", actionItems: [] },
    });

    // 2. cell_toggled — one per final toggle, spread linearly across
    // the first 80% of the drill window. Iteration order matches the
    // insertion order on `toggles` (preserved by V8/D8 object key order
    // for non-integer keys), so the replay reconstructs the final map.
    const toggleEntries = Object.entries(toggles);
    const totalToggles = toggleEntries.length;
    for (let t = 0; t < totalToggles; t++) {
      const [toggleKeyStr, nextVal] = toggleEntries[t]!;
      const offsetMs = totalToggles > 0 ? (t / totalToggles) * (durationMs * 0.8) : 0;
      const occurredAt = new Date(startedAt.getTime() + offsetMs);
      insertEvent(eventIdx++, occurredAt, {
        kind: "cell_toggled",
        key: toggleKeyStr,
        prev: null,
        next: nextVal,
      });
    }

    // 3. notes_changed — single event at 85% mark capturing the final
    // notes string verbatim (matches the run's `state.notes`).
    const notesAt = new Date(startedAt.getTime() + durationMs * 0.85);
    insertEvent(eventIdx++, notesAt, {
      kind: "notes_changed",
      prev: "",
      next: notes,
    });

    // 4. ended — terminal lifecycle event at endedAt.
    insertEvent(eventIdx++, endedAt, { kind: "ended" });
  }

  // 10. After-school programs.
  for (let p = 0; p < spec.programCount; p++) {
    const name = PROGRAM_NAMES[p % PROGRAM_NAMES.length]!;
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
        cancellationIdFor(spec.orgId, 1),
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
        dismissalExceptionIdFor(spec.orgId, e),
        spec.orgId,
        householdIds[e]!,
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
      rng.intBetween(0, PAST_CALL_EVENTS_LOOKBACK_DAYS) * 24 * 60 +
      rng.intBetween(DISMISSAL_WINDOW_START_UTC_MIN, DISMISSAL_WINDOW_END_UTC_MIN);
    const at = new Date(now.getTime() - minutesAgo * 60 * 1000);
    const studentName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    const homeRoom = homerooms[c % homerooms.length]!;
    const spaceNumber = (c % spaceCount) + 1;
    out.push({
      sql: `INSERT INTO "CallEvent" (orgId, spaceNumber, studentName, homeRoomSnapshot, createdAt, actorUserId)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [spec.orgId, spaceNumber, studentName, homeRoom, at.toISOString(), userIdFor(spec.orgId, "controller")],
    });
  }

  return out;
}
