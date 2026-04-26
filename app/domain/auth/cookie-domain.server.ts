/**
 * Cross-subdomain cookie gate. Apex marketing + tenant subdomains share
 * session cookies whenever the Worker is deployed at a real DNS apex
 * (i.e., PUBLIC_ROOT_DOMAIN points at a domain we own — e.g.
 * `pickuproster.com` or `staging.pickuproster.com`). Localhost-style
 * roots are excluded because browsers drop cookies with `Domain=localhost`.
 *
 * The `DISABLE_CROSS_SUBDOMAIN_COOKIES` env var is a kill switch for
 * incident response — set it to a truthy value to fall back to host-only
 * cookies without a redeploy.
 *
 * Note: cookies set on a request whose host does not match `root` will be
 * dropped by the browser. That's expected for the workers.dev fallback
 * hostname (no session persistence there; use the canonical apex).
 *
 * This file is deliberately dependency-free so it can be imported from
 * tests without dragging in `~/db.server` and the Prisma adapter chain.
 */

function normalizeRootDomain(env: Record<string, string | undefined>): string {
  return (env.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
}

function isTruthyEnv(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function shouldShareAuthCookiesAcrossSubdomains(
  root: string,
  env: Record<string, string | undefined>,
): boolean {
  if (!root) return false;
  if (isTruthyEnv(env.DISABLE_CROSS_SUBDOMAIN_COOKIES)) return false;
  if (root === "localhost" || root.endsWith(".localhost")) return false;
  if (root.includes("127.0.0.1")) return false;
  if (root.endsWith(".local")) return false;
  return true;
}

/** Set-Cookie `Domain` for shared apex + tenant cookies, or null for host-only. */
export function sharedSessionCookieDomain(context: any): string | null {
  const env = (context?.cloudflare?.env ?? (typeof process !== "undefined" ? process.env : {})) as Record<
    string,
    string | undefined
  >;
  const root = normalizeRootDomain(env);
  return shouldShareAuthCookiesAcrossSubdomains(root, env) ? root : null;
}

export { normalizeRootDomain };
