// scripts/demo-data/credentials.ts
//
// Resolves the admin password for each demo tenant. Order of precedence:
//   1. Per-org env var: DEMO_PASSWORD_<UPPER_KEY>, where UPPER_KEY is the
//      slug minus its `-example` suffix, with hyphens upper-cased to
//      underscores. Examples:
//        bhs-example              → DEMO_PASSWORD_BHS
//        westside-elem-example    → DEMO_PASSWORD_WESTSIDE_ELEM
//        lincoln-example          → DEMO_PASSWORD_LINCOLN
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

/**
 * Minimum length we accept for an operator-provided password
 * (`DEMO_PASSWORD_*`). Matches better-auth's default minimum so a demo
 * password is also a valid login password without further coercion.
 * Anything shorter is silently bypassed in favour of the seed-derived
 * password.
 */
const MIN_PROVIDED_PASSWORD_LENGTH = 8;

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

/**
 * Demo admin login email for a tenant. The seeder (`generate.ts`) and
 * `printSummary` both consume this so they cannot drift — if you change
 * the email shape, do it here.
 */
export function adminEmailFor(spec: DemoTenantSpec): string {
  return `admin@${spec.slug}.demo`;
}

/** Demo controller login email — same contract as `adminEmailFor`. */
export function controllerEmailFor(spec: DemoTenantSpec): string {
  return `controller@${spec.slug}.demo`;
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
    const perOrgUsable = !!perOrg && perOrg.length >= MIN_PROVIDED_PASSWORD_LENGTH;
    const fallbackUsable = !!fallback && fallback.length >= MIN_PROVIDED_PASSWORD_LENGTH;
    const password = perOrgUsable
      ? perOrg!
      : fallbackUsable
        ? fallback!
        : deriveFromSeed(seed, spec.slug);
    // True iff the password actually came from the seed-derive branch
    // — i.e. neither env var was set AND long enough to be used. Without
    // this, an operator who sets a too-short env var would see no
    // "[generated]" tag in the summary even though their value was
    // ignored and the seed-derived password was used instead.
    const generated = !perOrgUsable && !fallbackUsable;
    return {
      slug: spec.slug,
      adminEmail: adminEmailFor(spec),
      controllerEmail: controllerEmailFor(spec),
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
