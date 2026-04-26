// scripts/seed-demo-tenants.ts
//
// Usage:
//   tsx scripts/seed-demo-tenants.ts --target=local
//   tsx scripts/seed-demo-tenants.ts --target=remote --env=staging --out=demo-seed.staging.sql
//   tsx scripts/seed-demo-tenants.ts --target=remote --env=production --out=demo-seed.prod.sql
//   tsx scripts/seed-demo-tenants.ts --wipe-only --target=local
//
// `--target=local` writes directly to DATABASE_URL (default file:./dev.db).
// `--target=remote` writes a SQL file you then apply with:
//   wrangler d1 execute school-organizer-staging --remote --env=staging --file=demo-seed.staging.sql
//   wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql
//
// The npm scripts wire these two steps together. See package.json.

import { promises as fs } from "node:fs";
import { DEMO_TENANTS } from "./demo-data/specs";
import { generate, type GeneratedSeed } from "./demo-data/generate";
import { applyLibsql } from "./demo-data/apply-libsql";
import { emitSql } from "./demo-data/emit-sql";
import { resolveCredentials, printSummary } from "./demo-data/credentials";

interface Args {
  target: "local" | "remote";
  out?: string;
  wipeOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: "local", wipeOnly: false };
  for (const a of argv) {
    if (a === "--wipe-only") args.wipeOnly = true;
    else if (a.startsWith("--target=")) {
      const v = a.slice("--target=".length);
      if (v !== "local" && v !== "remote") {
        throw new Error(`--target must be local|remote, got ${v}`);
      }
      args.target = v;
    } else if (a.startsWith("--out=")) {
      args.out = a.slice("--out=".length);
    } else if (a.startsWith("--env=")) {
      // Accepted but unused — present so the npm scripts can pass it
      // through transparently. The actual env binding happens at the
      // wrangler step.
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (args.target === "remote" && !args.out) {
    args.out = "demo-seed.sql";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const creds = resolveCredentials(DEMO_TENANTS);
  const seed = await generate(DEMO_TENANTS, creds, new Date());

  // For --wipe-only, drop the seed half so we only delete demo rows.
  const effective: GeneratedSeed = args.wipeOnly
    ? { wipeStatements: seed.wipeStatements, seedStatements: [] }
    : seed;

  if (args.target === "local") {
    const url = process.env.DATABASE_URL ?? "file:./dev.db";
    const result = await applyLibsql(url, effective);
    console.log(`✓ Local seed applied to ${url}: wiped ${result.wiped}, seeded ${result.seeded}.`);
    if (!args.wipeOnly) printSummary(creds);
    return;
  }

  // Remote: write file. Apply via wrangler externally (see npm scripts).
  if (!args.out) throw new Error("--out is required for --target=remote");
  const sql = emitSql(effective);
  await fs.writeFile(args.out, sql, "utf8");
  console.log(`✓ Wrote ${sql.length.toLocaleString()} bytes to ${args.out}.`);
  console.log(`  Apply it with: wrangler d1 execute <db> --remote [--env <env>] --file=${args.out}`);
  if (!args.wipeOnly) printSummary(creds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
