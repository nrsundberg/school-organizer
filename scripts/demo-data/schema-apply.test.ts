// scripts/demo-data/schema-apply.test.ts
//
// Schema-drift smoke. Builds a fresh in-memory libsql DB from every
// `migrations/*.sql` in the repo, then runs the demo seed against it.
// If a future migration adds a NOT NULL column without a default to a
// table the seeder writes (Org, User, Student, etc.), this test fails
// at apply time — long before someone runs `npm run demo:seed:prod`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { generate } from "./generate";
import { DEMO_TENANTS } from "./specs";
import { resolveCredentials } from "./credentials";

test("seed applies cleanly to a fresh in-memory schema", async () => {
  // 1. Read every migration file in alphabetical order.
  const migrationsDir = path.resolve(import.meta.dirname, "../../migrations");
  const allEntries = await fs.readdir(migrationsDir);
  const sqlFiles = allEntries.filter((n) => n.endsWith(".sql")).sort();
  const migrationStatements: string[] = [];
  for (const f of sqlFiles) {
    const body = await fs.readFile(path.join(migrationsDir, f), "utf8");
    // Crude but sufficient: split on `;` at end of line, drop blanks
    // and SQL comments. Real migrations don't embed `;` inside string
    // literals so this is safe for our corpus.
    for (const raw of body.split(/;\s*\n/)) {
      const stripped = raw
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (stripped.length > 0) migrationStatements.push(stripped);
    }
  }

  // 2. Apply migrations to a fresh in-memory libsql.
  const db = createClient({ url: ":memory:" });
  try {
    for (const sql of migrationStatements) {
      await db.execute(sql);
    }

    // 3. Generate + apply the demo seed.
    const creds = resolveCredentials(DEMO_TENANTS, {
      DEMO_PASSWORD_SEED: "schema-drift-smoke",
    } as NodeJS.ProcessEnv);
    const seed = await generate(
      DEMO_TENANTS,
      creds,
      new Date("2026-04-25T15:00:00.000Z"),
    );
    const all = [...seed.wipeStatements, ...seed.seedStatements].map((s) => ({
      sql: s.sql,
      args: s.args,
    }));
    await db.batch(all, "write");

    // 4. Sanity check: 5 demo orgs landed.
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM "Org" WHERE id LIKE 'org_demo_%'`,
      args: [],
    });
    assert.equal(Number(rs.rows[0]!.n), 5);
  } finally {
    db.close();
  }
});
