/**
 * Shared org slug normalization for client previews, suggestions, and server persistence.
 */
export function slugifyOrgName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const LEADING_ARTICLES = new Set(["a", "an", "the"]);

/** First-letter initials from significant words (for short slug suggestions). */
function initialsSlugFromOrgName(orgName: string): string | null {
  const trimmed = orgName.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/[\s-]+/).filter(Boolean);
  let start = 0;
  if (tokens.length > 0 && LEADING_ARTICLES.has(tokens[0]!.toLowerCase())) {
    start = 1;
  }
  let initials = "";
  for (let i = start; i < tokens.length; i++) {
    const m = tokens[i]!.match(/[a-zA-Z]/);
    if (m) initials += m[0]!.toLowerCase();
  }
  if (initials.length < 2) return null;
  return initials.slice(0, 50);
}

/** Suggested slugs from a school name (initials-style short slug first when applicable). */
export function suggestOrgSlugsFromName(orgName: string): string[] {
  const base = slugifyOrgName(orgName);
  if (!base) return [];
  const initials = initialsSlugFromOrgName(orgName);
  const initialsCandidate =
    initials && initials !== base ? initials : null;
  const candidates = [
    initialsCandidate,
    base,
    base.length <= 42 ? `${base}-school` : null,
    base.length <= 40 ? `${base}-academy` : null,
  ].filter((s): s is string => !!s);
  return [...new Set(candidates)];
}

/**
 * Hostname for the school's subdomain board URL (matches dev *.localhost and prod *.root).
 */
export function schoolBoardHostname(hostname: string, slug: string): string {
  const h = hostname.toLowerCase().split(":")[0];
  const root = h.startsWith("www.") ? h.slice(4) : h;
  const safe = slugifyOrgName(slug) || slug.trim().toLowerCase();
  if (!safe) return root;
  if (root === "localhost") return `${safe}.localhost`;
  return `${safe}.${root}`;
}

/** Absolute board URL for a tenant slug; preserves scheme and port from the current request. */
export function tenantBoardUrlFromRequest(request: Request, slug: string): string {
  const u = new URL(request.url);
  const boardHost = schoolBoardHostname(u.hostname, slug);
  const port = u.port;
  const origin =
    port !== ""
      ? `${u.protocol}//${boardHost}:${port}`
      : `${u.protocol}//${boardHost}`;
  return `${origin}/`;
}
