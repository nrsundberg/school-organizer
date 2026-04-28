import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildManifest,
  DELETE_ORDER,
  EXPORT_WHITELIST,
  whitelistRow,
  type ExportTable,
} from "./data-export.server";

test("whitelistRow keeps only whitelisted columns", () => {
  const row = {
    id: 1,
    firstName: "Alice",
    lastName: "Adams",
    homeRoom: "5A",
    spaceNumber: 12,
    householdId: "h1",
    // junk that should be dropped:
    notWhitelisted: "should not appear",
  };
  const out = whitelistRow("students", row);
  assert.deepEqual(Object.keys(out).sort(), [
    "firstName",
    "homeRoom",
    "householdId",
    "id",
    "lastName",
    "spaceNumber",
  ]);
  assert.equal((out as { firstName: string }).firstName, "Alice");
});

test("whitelistRow normalizes Date columns to ISO strings", () => {
  const now = new Date("2026-04-28T01:23:45.678Z");
  const out = whitelistRow("callEvents", {
    id: 99,
    spaceNumber: 1,
    studentId: 7,
    studentName: "Bob",
    homeRoomSnapshot: "K-A",
    actorUserId: "u1",
    onBehalfOfUserId: null,
    createdAt: now,
  });
  assert.equal(out.createdAt, "2026-04-28T01:23:45.678Z");
});

test("user whitelist drops passwordHash and similar credential fields", () => {
  // Hard regression test: even if a future schema change adds these to the
  // User row Prisma returns, the whitelist must keep them out of the dump.
  const row = {
    id: "u1",
    email: "admin@example.com",
    name: "Admin",
    phone: "+15555550100",
    role: "ADMIN",
    locale: "en",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    // poisoned columns:
    passwordHash: "$2b$10$forbidden",
    sessionToken: "secret-token",
    twoFactorSecret: "TOTP123",
    stripeCustomerId: "cus_xyz",
  };
  const out = whitelistRow("users", row);
  for (const k of [
    "passwordHash",
    "sessionToken",
    "twoFactorSecret",
    "stripeCustomerId",
  ]) {
    assert.equal(k in out, false, `${k} must not leak into export`);
  }
  assert.equal(out.email, "admin@example.com");
});

test("appSettings whitelist drops viewerPinHash", () => {
  const out = whitelistRow("appSettings", {
    orgId: "org_1",
    viewerDrawingEnabled: true,
    viewerPinHash: "$2b$10$leaked",
  });
  assert.equal("viewerPinHash" in out, false);
  assert.equal(out.viewerDrawingEnabled, true);
});

test("buildManifest returns the documented shape", () => {
  const manifest = buildManifest({
    orgId: "org_1",
    orgSlug: "demo",
    exportedAt: new Date("2026-04-28T02:00:00.000Z"),
    exportedByUserId: "user_admin",
    planAtExport: "CAMPUS",
    rowCounts: { students: 412, teachers: 38, callEvents: 4217 },
  });
  assert.equal(manifest.schemaVersion, "1");
  assert.equal(manifest.orgSlug, "demo");
  assert.equal(manifest.exportedAt, "2026-04-28T02:00:00.000Z");
  assert.deepEqual(manifest.rowCounts, {
    students: 412,
    teachers: 38,
    callEvents: 4217,
  });
});

test("EXPORT_WHITELIST covers every ExportTable", () => {
  // Compile-time check the union and the table both stay in sync.
  const tables: readonly ExportTable[] = [
    "students",
    "teachers",
    "spaces",
    "callEvents",
    "users",
    "households",
    "dismissalExceptions",
    "afterSchoolPrograms",
    "programCancellations",
    "appSettings",
    "auditLog",
  ];
  for (const t of tables) {
    assert.ok(
      Array.isArray(EXPORT_WHITELIST[t]) && EXPORT_WHITELIST[t].length > 0,
      `${t} has no whitelisted columns`,
    );
  }
});

test("DELETE_ORDER puts user last and parents after dependents", () => {
  // user must be the final tail: anything that has actorUserId/createdByUserId
  // FKs nulled-on-delete should still be deleted before its referenced user
  // rows go away, otherwise a partial-failure reorder could leak a row.
  assert.equal(DELETE_ORDER[DELETE_ORDER.length - 1], "user");

  // student -> household: student must come before household (student
  // references household via SetNull, so order doesn't strictly matter, but
  // we delete the dependent first to keep the cascade obvious).
  const studentIdx = DELETE_ORDER.indexOf("student");
  const householdIdx = DELETE_ORDER.indexOf("household");
  assert.ok(
    studentIdx < householdIdx,
    "student before household (dependents first)",
  );

  // callEvent must come before space + student (callEvent FK to both).
  const callEventIdx = DELETE_ORDER.indexOf("callEvent");
  const spaceIdx = DELETE_ORDER.indexOf("space");
  assert.ok(callEventIdx < spaceIdx, "callEvent before space");
  assert.ok(callEventIdx < studentIdx, "callEvent before student");

  // programCancellation before afterSchoolProgram (FK chain).
  assert.ok(
    DELETE_ORDER.indexOf("programCancellation") <
      DELETE_ORDER.indexOf("afterSchoolProgram"),
    "programCancellation before afterSchoolProgram",
  );
});
