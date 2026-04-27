/**
 * Seeds the initial admin user into the local dev database.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * For D1 (production), run the SQL printed at the end with:
 *   wrangler d1 execute school-organizer --command "<SQL>"
 */
import { createClient } from "@libsql/client";
// Password hashing + id helpers live alongside the e2e seeded-tenant
// fixture so both paths stay in lockstep with the PBKDF2 params in
// app/domain/auth/better-auth.server.ts.
import { hashPassword, generateId } from "../e2e/fixtures/seed-helpers";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

async function seed() {
  const email = "noahsundberg@gmail.com";
  const name = "Noah Sundberg";
  const role = "ADMIN";

  // Random temp password — user will be forced to change it on first login
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const tempPassword = Array.from(bytes, (b) => chars[b % chars.length]).join("");

  const hashed = await hashPassword(tempPassword);
  const now = new Date().toISOString();

  // Check if user already exists
  const existing = await db.execute({
    sql: `SELECT id FROM "User" WHERE email = ?`,
    args: [email],
  });

  let userId: string;

  if (existing.rows.length > 0) {
    userId = existing.rows[0].id as string;
    // Update password and reset mustChangePassword flag
    await db.execute({
      sql: `UPDATE "User" SET mustChangePassword = 1, updatedAt = ? WHERE id = ?`,
      args: [now, userId],
    });
    await db.execute({
      sql: `UPDATE "Account" SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'`,
      args: [hashed, now, userId],
    });
    console.log(`✓ Reset password for existing user ${email}`);
  } else {
    userId = generateId();
    const accountId = generateId();

    await db.execute({
      sql: `INSERT INTO "User" (id, email, name, role, emailVerified, mustChangePassword, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
      args: [userId, email, name, role, now, now],
    });

    await db.execute({
      sql: `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      args: [accountId, email, userId, hashed, now, now],
    });

    console.log(`✓ Created ${name} (${email}) as ${role}`);
  }

  console.log(`\n  Temporary password: ${tempPassword}`);
  console.log(`  → They will be prompted to set a new password on first login.\n`);

  // Ensure the seeded user is attached to an Org. On a virgin DB the User
  // INSERT above doesn't set orgId — without an org the tenant-scoped
  // routes (drills, history, dashboard) all bail, and the demo template +
  // historical runs below would silently no-op. Use a stable "dev" slug
  // so re-runs and other dev tooling can find the same org.
  const devOrgSlug = "dev";
  const devOrgName = "Dev School";
  let userOrgId: string | undefined;
  const userOrgRow = await db.execute({
    sql: `SELECT "orgId" FROM "User" WHERE id = ?`,
    args: [userId],
  });
  userOrgId = (userOrgRow.rows[0]?.orgId as string | null) ?? undefined;

  if (!userOrgId) {
    const existingOrg = await db.execute({
      sql: `SELECT id FROM "Org" WHERE slug = ?`,
      args: [devOrgSlug],
    });
    if (existingOrg.rows.length > 0) {
      userOrgId = existingOrg.rows[0].id as string;
    } else {
      userOrgId = generateId();
      await db.execute({
        sql: `INSERT INTO "Org" (id, name, slug, status, billingPlan, createdAt, updatedAt)
              VALUES (?, ?, ?, 'ACTIVE', 'FREE', ?, ?)`,
        args: [userOrgId, devOrgName, devOrgSlug, now, now],
      });
      console.log(`✓ Created dev Org "${devOrgSlug}" (${userOrgId})`);
    }
    await db.execute({
      sql: `UPDATE "User" SET "orgId" = ?, updatedAt = ? WHERE id = ?`,
      args: [userOrgId, now, userId],
    });
    console.log(`✓ Attached ${email} to org "${devOrgSlug}"`);
  }

  const demoDefinition = JSON.stringify({
    columns: [
      { id: "fdcol-grade", label: "Grade", kind: "text" },
      { id: "fdcol-teacher", label: "Teacher", kind: "text" },
      { id: "fdcol-check", label: "Check", kind: "toggle" },
    ],
    rows: [
      { id: "fdrow-1", cells: { "fdcol-grade": "K", "fdcol-teacher": "Example" } },
      { id: "fdrow-2", cells: { "fdcol-grade": "Specials", "fdcol-teacher": "" } },
      { id: "fdrow-3", cells: { "fdcol-grade": "Office", "fdcol-teacher": "" } },
    ],
  });

  try {
    const orgId = userOrgId;
    if (orgId) {
      const exists = await db.execute({
        sql: `SELECT id FROM "DrillTemplate" WHERE "orgId" = ? AND name = ?`,
        args: [orgId, "Fire drill"],
      });
      let templateId: string | undefined;
      if (exists.rows.length === 0) {
        templateId = generateId();
        await db.execute({
          sql: `INSERT INTO "DrillTemplate" (id, "orgId", name, definition, "createdAt", "updatedAt")
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [templateId, orgId, "Fire drill", demoDefinition, now, now],
        });
        console.log(`✓ Seeded demo "Fire drill" checklist template for org ${orgId}`);
      } else {
        templateId = exists.rows[0].id as string;
      }

      // Historical DrillRuns for the seeded "Fire drill" template. Two
      // ENDED runs (~7d and ~30d ago, ~12 minutes long) so the local
      // /admin/drills history view has something to render. Each run is
      // attributed to the seeded admin via lastActorUserId — required
      // now that the dismissal "call a spot" path is locked down to
      // ADMIN/CONTROLLER and historical rows must reflect a real human.
      // Idempotent: skip if any DrillRun already exists for this template.
      if (templateId) {
        const existingRuns = await db.execute({
          sql: `SELECT id FROM "DrillRun" WHERE "templateId" = ?`,
          args: [templateId],
        });
        if (existingRuns.rows.length === 0) {
          const runDurationMs = 12 * 60 * 1000;
          const runs = [
            {
              daysAgo: 7,
              state: {
                toggles: {
                  "fdrow-1:fdcol-check": "positive",
                  "fdrow-2:fdcol-check": "positive",
                  "fdrow-3:fdcol-check": "positive",
                },
                notes: "All clear. Office staff swept perimeter.",
                actionItems: [],
              },
            },
            {
              daysAgo: 30,
              state: {
                toggles: {
                  "fdrow-1:fdcol-check": "positive",
                  "fdrow-2:fdcol-check": "positive",
                },
                notes:
                  "K and Specials wings cleared in 3:42. Office wing slow — radio battery dead.",
                actionItems: [],
              },
            },
          ];
          for (const run of runs) {
            const runId = generateId();
            const startedAt = new Date(
              Date.now() - run.daysAgo * 24 * 60 * 60 * 1000,
            );
            const endedAt = new Date(startedAt.getTime() + runDurationMs);
            const startedIso = startedAt.toISOString();
            const endedIso = endedAt.toISOString();
            await db.execute({
              sql: `INSERT INTO "DrillRun" (id, "orgId", "templateId", state, status, "activatedAt", "endedAt", "lastActorUserId", "createdAt", "updatedAt")
                    VALUES (?, ?, ?, ?, 'ENDED', ?, ?, ?, ?, ?)`,
              args: [
                runId,
                orgId,
                templateId,
                JSON.stringify(run.state),
                startedIso,
                endedIso,
                userId,
                startedIso,
                endedIso,
              ],
            });
          }
          console.log(
            `✓ Seeded ${runs.length} historical "Fire drill" runs for org ${orgId}`,
          );
        }
      }
    }
  } catch (e) {
    console.warn("Skipping drill template seed (run migrations if the table is missing):", e);
  }

  db.close();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
