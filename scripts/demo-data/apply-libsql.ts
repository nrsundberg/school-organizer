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
