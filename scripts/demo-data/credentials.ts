// scripts/demo-data/credentials.ts
//
// Resolves the admin password for each demo tenant. Order of precedence:
//   1. Per-org env var: DEMO_PASSWORD_<UPPER_KEY> (e.g. DEMO_PASSWORD_BHS)
//   2. Global env var:  DEMO_PASSWORD_DEFAULT
//   3. Generated: derived deterministically from DEMO_PASSWORD_SEED so a
//      seeded run + the same seed always yields the same password.
//
// We never hardcode plaintext passwords in git. The function `printSummary`
// prints a single block at the end of a seed run with all admin emails +
// passwords so the operator can record them.

import { createHash } from "node:crypto";
import type { DemoTenantSpec } from "./specs";

const DEFAULT_GENERATED_LENGTH = 16;

/** Convert a slug like "westside-elem-example" → "WESTSIDE_ELEM". */
function envKey(spec: DemoTenantSpec): string {
  return spec.slug
    .replace(/-example$/, "")
    .replace(/-/g, "_")
    .toUpperCase();
}

function deriveFromSeed(seed: string, slug: string): string {
  // Deterministic but not reversible — sha256(seed + slug), base64url
  // truncated. Node's createHash is fine here; this CLI never runs in
  // the Workers runtime so we don't need crypto.subtle.
  const buf = createHash("sha256").update(`${seed}::${slug}`).digest();
  return buf
    .toString("base64")
    .replace(/[+/=]/g, "")
    .slice(0, DEFAULT_GENERATED_LENGTH);
}

export interface DemoCredential {
  slug: string;
  adminEmail: string;
  controllerEmail: string;
  password: string;
  /** True when the password was generated rather than read from env. */
  generated: boolean;
}

export function resolveCredentials(
  specs: readonly DemoTenantSpec[],
  env: NodeJS.ProcessEnv = process.env,
): DemoCredential[] {
  const seed = env.DEMO_PASSWORD_SEED ?? "demo-tenants-fallback-seed";
  const fallback = env.DEMO_PASSWORD_DEFAULT;

  return specs.map((spec) => {
    const perOrg = env[`DEMO_PASSWORD_${envKey(spec)}`];
    const password =
      perOrg && perOrg.length >= 8
        ? perOrg
        : fallback && fallback.length >= 8
          ? fallback
          : deriveFromSeed(seed, spec.slug);
    const generated = !perOrg && !fallback;
    return {
      slug: spec.slug,
      adminEmail: `admin@${spec.slug}.demo`,
      controllerEmail: `controller@${spec.slug}.demo`,
      password,
      generated,
    };
  });
}

export function printSummary(creds: readonly DemoCredential[]): void {
  console.log("\n=== Demo tenant credentials ===");
  console.log("(admins and controllers share one password per org; both can log in)\n");
  for (const c of creds) {
    const tag = c.generated ? " [generated from DEMO_PASSWORD_SEED]" : "";
    console.log(`  ${c.slug}${tag}`);
    console.log(`    admin:      ${c.adminEmail}`);
    console.log(`    controller: ${c.controllerEmail}`);
    console.log(`    password:   ${c.password}\n`);
  }
}
