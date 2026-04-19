/**
 * Marketing vs tenant host detection using PUBLIC_ROOT_DOMAIN (e.g. schoolorganizer.com).
 * Apex and www → marketing. {slug}.root → tenant slug. MARKETING_HOSTS adds dev hosts (localhost).
 */

export function getPublicEnv(context: any): Record<string, string | undefined> {
  return (context?.cloudflare?.env ?? (typeof process !== "undefined" ? process.env : {})) as Record<
    string,
    string | undefined
  >;
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
 * Slug for tenant subdomain: tome.schoolorganizer.com → "tome".
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
    return tenantSlugFromHost(request, context);
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
