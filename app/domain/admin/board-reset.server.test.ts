/**
 * Unit tests for buildBoardResetBatch (board-reset.server.ts).
 *
 * Core behaviour under test (fixes #74):
 *   - Board reset clears Space statuses.
 *   - Board reset stamps AppSettings.lastBoardResetAt.
 *   - Board reset does NOT touch CallEvent rows so /admin/history survives
 *     across daily resets.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildBoardResetBatch } from "./board-reset.server";

// ---------------------------------------------------------------------------
// Minimal D1 fake — records which SQL strings were prepared and which bind
// values were attached. Cast to the ambient `D1Database` type; only `prepare`
// and `bind` are exercised by buildBoardResetBatch.
// ---------------------------------------------------------------------------

type PreparedCall = { sql: string; bindings: unknown[] };

function fakeD1(): { d1: D1Database; calls: PreparedCall[] } {
  const calls: PreparedCall[] = [];

  function makeStmt(sql: string, bindings: unknown[]) {
    return {
      bind: (...values: unknown[]) => makeStmt(sql, [...bindings, ...values]),
      // Expose the captured state so the test can inspect it.
      _sql: sql,
      _bindings: bindings,
    };
  }

  const d1 = {
    prepare(sql: string) {
      const stmt = makeStmt(sql, []);
      // Wrap bind to record the final stmt into calls when the outer batch
      // collects it. We record lazily via a Proxy so we catch whatever
      // bind chain the caller uses.
      return new Proxy(stmt, {
        get(target, prop) {
          if (prop === "bind") {
            return (...values: unknown[]) => {
              const next = makeStmt(sql, [...target._bindings, ...values]);
              calls.push({ sql, bindings: next._bindings });
              return next;
            };
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      }) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;

  return { d1, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("buildBoardResetBatch: returns exactly 2 statements (Space reset + AppSettings stamp)", () => {
  const { d1 } = fakeD1();
  const stmts = buildBoardResetBatch(d1, "org_test", "2026-01-01T08:00:00.000Z");
  assert.equal(stmts.length, 2, "expected exactly 2 SQL statements in the batch");
});

test("buildBoardResetBatch: first statement updates Space, not CallEvent", () => {
  const { d1, calls } = fakeD1();
  buildBoardResetBatch(d1, "org_test", "2026-01-01T08:00:00.000Z");
  const first = calls[0];
  assert.ok(first.sql.includes('"Space"'), "first statement should reference Space table");
  assert.ok(!first.sql.includes("CallEvent"), "first statement must NOT touch CallEvent");
  assert.ok(first.sql.toUpperCase().includes("UPDATE"), "first statement should be an UPDATE");
  assert.deepEqual(first.bindings, ["EMPTY", "org_test"]);
});

test("buildBoardResetBatch: second statement upserts AppSettings.lastBoardResetAt", () => {
  const { d1, calls } = fakeD1();
  const nowIso = "2026-01-01T08:00:00.000Z";
  buildBoardResetBatch(d1, "org_test", nowIso);
  const second = calls[1];
  assert.ok(second.sql.includes('"AppSettings"'), "second statement should reference AppSettings");
  assert.ok(second.sql.includes("lastBoardResetAt"), "second statement should set lastBoardResetAt");
  assert.ok(!second.sql.includes("CallEvent"), "second statement must NOT touch CallEvent");
  // orgId is first binding; nowIso is second (inside INSERT … ON CONFLICT …).
  assert.ok(second.bindings.includes("org_test"), "binding should include orgId");
  assert.ok(second.bindings.includes(nowIso), "binding should include the timestamp");
});

test("buildBoardResetBatch: no statement references CallEvent (history must persist)", () => {
  const { d1, calls } = fakeD1();
  buildBoardResetBatch(d1, "org_any", "2026-06-19T09:30:00.000Z");
  for (const { sql } of calls) {
    assert.ok(
      !sql.includes("CallEvent"),
      `Found unexpected reference to CallEvent in SQL: ${sql}`,
    );
  }
});

test("buildBoardResetBatch: scopes Space update to the provided orgId", () => {
  const { d1, calls } = fakeD1();
  buildBoardResetBatch(d1, "org_specific", "2026-01-01T00:00:00.000Z");
  const spaceStmt = calls.find((c) => c.sql.includes('"Space"'));
  assert.ok(spaceStmt, "expected a Space statement");
  assert.ok(
    spaceStmt.bindings.includes("org_specific"),
    "Space update must be scoped to the correct orgId",
  );
});
