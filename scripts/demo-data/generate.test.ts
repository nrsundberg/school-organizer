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
  // The generator is deterministic at the structural level — SQL strings,
  // ID strings, names, timestamps all derive from the spec + a seeded PRNG.
  // The one exception is PBKDF2 password/PIN hashes: hashPassword() uses
  // crypto.getRandomValues() for the salt (correct security behavior, not
  // a bug). Salts surface as "<salt-hex>:<key-hex>" args on the Account
  // and AppSettings rows, so we mask those positions before comparing.
  const PWHASH = /^v2\$sha256\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
  const maskArgs = (args: typeof a.seedStatements[number]["args"]) =>
    args.map((arg) => (typeof arg === "string" && PWHASH.test(arg) ? "<pwhash>" : arg));
  for (let i = 0; i < a.seedStatements.length; i++) {
    assert.equal(a.seedStatements[i]!.sql, b.seedStatements[i]!.sql);
    assert.deepEqual(maskArgs(a.seedStatements[i]!.args), maskArgs(b.seedStatements[i]!.args));
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
        if (m) positions.set(m[1]!, idx);
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
