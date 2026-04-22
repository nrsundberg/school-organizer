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

// Must match hashPassword/verifyPassword in better-auth.server.ts
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_KEY_LEN = 32;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt, iterations: PBKDF2_ITERATIONS },
    key,
    PBKDF2_KEY_LEN * 8,
  );
  return `${toHex(salt.buffer)}:${toHex(bits)}`;
}

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});

function generateId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "0")
    .replace(/\//g, "0")
    .slice(0, 24);
}

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
    const orgRow = await db.execute({
      sql: `SELECT "orgId" FROM "User" WHERE email = ?`,
      args: [email],
    });
    const orgId = orgRow.rows[0]?.orgId as string | undefined;
    if (orgId) {
      const exists = await db.execute({
        sql: `SELECT id FROM "DrillTemplate" WHERE "orgId" = ? AND name = ?`,
        args: [orgId, "Fire drill"],
      });
      if (exists.rows.length === 0) {
        const templateId = generateId();
        await db.execute({
          sql: `INSERT INTO "DrillTemplate" (id, "orgId", name, definition, "createdAt", "updatedAt")
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [templateId, orgId, "Fire drill", demoDefinition, now, now],
        });
        console.log(`✓ Seeded demo "Fire drill" checklist template for org ${orgId}`);
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
