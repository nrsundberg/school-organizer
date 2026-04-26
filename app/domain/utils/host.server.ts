/**
 * Marketing vs tenant host detection using PUBLIC_ROOT_DOMAIN (e.g. pickuproster.com).
 * Apex and www → marketing. {slug}.root → tenant slug. MARKETING_HOSTS adds dev hosts (localhost).
 */

export function getPublicEnv(context: any): Record<string, string | undefined> {
  return (context?.cloudflare?.env ?? (typeof process !== "undefined" ? process.env : {})) as Record<
    string,
    string | undefined
  >;
}

/** Same policy as `isPlatformAdmin` in platform-admin.server (kept here for host/middleware helpers). */
export function isPlatformAdmin(
  user: { email: string; role: string } | null,
  context: any,
): boolean {
  if (!user) return false;
  if (user.role === "PLATFORM_ADMIN") return true;
  const env = getPublicEnv(context);
  const allow = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(user.email.toLowerCase());
}

/**
 * Origin for the marketing site (apex of PUBLIC_ROOT_DOMAIN), preserving scheme and port from the request.
 * Used to redirect users away from tenant hosts when they must use marketing-only flows.
 */
export function marketingOriginFromRequest(request: Request, context: any): string {
  const env = getPublicEnv(context);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
  const u = new URL(request.url);
  const host = root || "localhost";
  const port = u.port;
  return port ? `${u.protocol}//${host}:${port}` : `${u.protocol}//${host}`;
}

function normalizeHost(request: Request): string {
  return new URL(request.url).host.toLowerCase().split(":")[0];
}

function extraMarketingHosts(env: Record<string, string | undefined>): string[] {
  return (env.MARKETING_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True for apex and www of PUBLIC_ROOT_DOMAIN, or hosts listed in MARKETING_HOSTS. */
export function isMarketingHost(request: Request, context: any): boolean {
  const env = getPublicEnv(context);
  const host = normalizeHost(request);
  if (extraMarketingHosts(env).includes(host)) return true;
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
  if (!root) return false;
  return host === root || host === `www.${root}`;
}

/**
 * Slug for tenant subdomain: tome.pickuproster.com → "tome".
 * Returns null for apex, www, or non-matching hosts.
 */
export function tenantSlugFromHost(request: Request, context: any): string | null {
  const env = getPublicEnv(context);
  const host = normalizeHost(request);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
  if (!root) {
    return devTenantSlug(host);
  }
  const suffix = `.${root}`;
  if (!host.endsWith(suffix) || host === root || host === `www.${root}`) {
    return null;
  }
  const prefix = host.slice(0, -suffix.length);
  if (!prefix || prefix.includes(".") || prefix === "www") return null;
  return prefix;
}

/** e.g. tome.localhost → tome */
export function devTenantSlug(host: string): string | null {
  if (host.endsWith(".localhost") && host !== "localhost") {
    const sub = host.slice(0, -".localhost".length);
    if (sub && !sub.includes(".")) return sub;
  }
  return null;
}

/** Slug used to resolve Org from hostname (PUBLIC_ROOT_DOMAIN mode, dev *.localhost, or legacy 3+ label hosts). */
export function resolveTenantSlugFromHost(request: Request, context: any): string | null {
  const host = normalizeHost(request);
  const env = getPublicEnv(context);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
  if (root) {
    // Production / staging: {slug}.PUBLIC_ROOT_DOMAIN.
    const bySuffix = tenantSlugFromHost(request, context);
    if (bySuffix) return bySuffix;
    // Dev fallback: wrangler dev (and the e2e webServer) boot with the
    // production PUBLIC_ROOT_DOMAIN baked in via wrangler.jsonc, but
    // local dev and the seeded-tenant Playwright fixture drive tenant
    // traffic over `{slug}.localhost`. Without this fall-through the
    // tenant subdomain doesn't resolve a slug, resolveOrgByHost lands
    // on the "first org by createdAt" backstop, and admin flows bounce
    // to /login because the seeded admin's orgId doesn't match the
    // wrong-tenant org the middleware picked.
    return devTenantSlug(host);
  }
  return devTenantSlug(host) ?? legacySubdomainSlug(host);
}

/** Legacy: foo.bar.baz → foo when 3+ labels (matches previous branding helper behavior). */
export function legacySubdomainSlug(host: string): string | null {
  const bare = host.split(":")[0].toLowerCase();
  if (!bare || bare === "localhost") return null;
  const parts = bare.split(".");
  if (parts.length < 3) return null;
  const candidate = parts[0]?.trim();
  return candidate || null;
}
