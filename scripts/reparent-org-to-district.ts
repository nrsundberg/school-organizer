/**
 * Move an existing standalone Org under a District. Manual operation —
 * platform staff only. Run via:
 *
 *   npx tsx scripts/reparent-org-to-district.ts <orgId> <districtId>
 *
 * For local SQLite (dev.db), this hits DATABASE_URL directly via libsql.
 * For staging/production D1, see docs/runbooks/reparent-org-to-district.md.
 *
 * Effects:
 *   - Sets Org.districtId = districtId.
 *   - Writes a DistrictAuditLog entry.
 *   - Does NOT touch Stripe — cancel the Org's per-school subscription
 *     manually before running.
 */
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

function newCuid(): string {
  // Lightweight cuid-ish: timestamp + random. Good enough for a one-off
  // audit-log row. Production scripts should generate real cuids if used
  // at scale.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `c${Date.now().toString(36)}${hex}`;
}

async function main() {
  const [orgId, districtId] = process.argv.slice(2);
  if (!orgId || !districtId) {
    console.error("usage: reparent-org-to-district <orgId> <districtId>");
    process.exit(1);
  }

  const orgRow = await db.execute({
    sql: 'SELECT id, slug FROM "Org" WHERE id = ?',
    args: [orgId],
  });
  if (orgRow.rows.length === 0) {
    throw new Error(`Org ${orgId} not found.`);
  }
  const orgSlug = String(orgRow.rows[0].slug);

  const districtRow = await db.execute({
    sql: 'SELECT id, slug FROM "District" WHERE id = ?',
    args: [districtId],
  });
  if (districtRow.rows.length === 0) {
    throw new Error(`District ${districtId} not found.`);
  }
  const districtSlug = String(districtRow.rows[0].slug);

  await db.execute({
    sql: 'UPDATE "Org" SET "districtId" = ? WHERE id = ?',
    args: [districtId, orgId],
  });

  await db.execute({
    sql:
      'INSERT INTO "DistrictAuditLog" ' +
      '(id, districtId, action, targetType, targetId, details, createdAt) ' +
      "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    args: [
      newCuid(),
      districtId,
      "district.school.created",
      "Org",
      orgId,
      JSON.stringify({ reparentedFromStandalone: true, slug: orgSlug }),
    ],
  });

  console.log(`Reparented ${orgSlug} -> district ${districtSlug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
