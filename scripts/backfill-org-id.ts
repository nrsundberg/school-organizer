/**
 * Backfills orgId on tenant-scoped tables for pre-multi-tenant data.
 *
 * Usage:
 *   npx tsx scripts/backfill-org-id.ts
 *
 * Optional env vars:
 *   DATABASE_URL=file:./dev.db
 *   DEFAULT_ORG_ID=org_tome
 *   DEFAULT_ORG_SLUG=tome
 *   DEFAULT_ORG_NAME="Tome"
 */
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

const defaultOrgId = process.env.DEFAULT_ORG_ID ?? "org_tome";
const defaultOrgSlug = process.env.DEFAULT_ORG_SLUG ?? "tome";
const defaultOrgName = process.env.DEFAULT_ORG_NAME ?? "Tome";

const tenantTables = [
  "AppSettings",
  "ViewerAccessAttempt",
  "ViewerAccessSession",
  "ViewerMagicLink",
  "Teacher",
  "Student",
  "Space",
  "CallEvent",
] as const;

async function runBackfill() {
  await db.execute("BEGIN");

  try {
    await db.execute({
      sql: `INSERT INTO "Org" ("id", "slug", "name", "status", "billingPlan")
            SELECT ?, ?, ?, 'ACTIVE', 'FREE'
            WHERE NOT EXISTS (SELECT 1 FROM "Org" WHERE "id" = ?)`,
      args: [defaultOrgId, defaultOrgSlug, defaultOrgName, defaultOrgId],
    });

    for (const table of tenantTables) {
      const result = await db.execute({
        sql: `UPDATE "${table}" SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`,
        args: [defaultOrgId],
      });
      console.log(`Updated ${result.rowsAffected ?? 0} rows in ${table}`);
    }

    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK");
    throw error;
  }
}

runBackfill()
  .then(async () => {
    for (const table of tenantTables) {
      const result = await db.execute(
        `SELECT COUNT(*) AS count FROM "${table}" WHERE "orgId" IS NULL OR "orgId" = ''`,
      );
      const missing = Number(result.rows[0]?.count ?? 0);
      if (missing > 0) {
        throw new Error(`${table} still has ${missing} rows with missing orgId`);
      }
    }
    console.log("orgId backfill completed successfully.");
  })
  .catch((error) => {
    console.error("orgId backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
