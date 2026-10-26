/**
 * Search-indexing decisions that do not need the markdown loaders.
 *
 * Content filenames and retired slugs were requested as their own URLs.
 * This module decides the 301, the 410, and which hosts and paths are
 * marketing duplicates or noindex utility pages.
 */

import { ROBOTS_DISALLOW_PATHS } from "./marketing-seo";

/** Retired URLs that have a current page. */
export const LEGACY_PATH_REDIRECTS: Record<string, string> = {
  "/guides/handling-early-dismissal-requests":
    "/blog/staff-workflows-who-approves-early-dismissal",
  "/guides/privacy-and-ferpa-in-pickup-logistics":
    "/blog/privacy-and-ferpa-in-pickup-logistics",
  "/blog/structured-lanes-that-actually-cut-car-line-wait-times":
    "/blog/reducing-car-line-wait-times-with-structured-lanes",
};

const CONTENT_FILE =
  /^\/content\/(blog|guides)\/(?:(\d{4}-\d{2}-\d{2})-)?(?:manual-\d+-)?([a-z0-9-]+)\.md$/;

/** Marketing documents the app host must send to the apex. The tenant home stays. */
const APP_MARKETING_EXACT = new Set([
  "/pricing",
  "/faqs",
  "/status",
  "/signup",
  "/blog",
  "/guides",
  "/demo",
  "/book/intro",
  "/school-pickup-board",
  "/contact",
  "/sitemap.xml",
]);

export type ContentSlugSets = {
  blog: ReadonlySet<string>;
  guides: ReadonlySet<string>;
};

export type IndexingAction =
  | { type: "redirect"; path: string; preserveSearch: boolean }
  | { type: "gone" };

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function isAppHostname(
  hostname: string,
  rootDomain: string | undefined,
): boolean {
  const root = (rootDomain ?? "").trim().toLowerCase();
  if (!root || root === "localhost" || root.endsWith(".localhost")) return false;
  return hostname.toLowerCase() === `app.${root}`;
}

export function isAppMarketingPath(pathname: string): boolean {
  const path = decodePath(pathname).toLowerCase();
  if (APP_MARKETING_EXACT.has(path)) return true;
  return (
    path.startsWith("/blog/") ||
    path.startsWith("/guides/") ||
    path.startsWith("/compare/")
  );
}

/**
 * `/content/(blog|guides)/<date>-[manual-NNNN-]<slug>.md` → the public page
 * when that slug exists. Any other markdown source path under those two
 * directories is gone.
 */
export function contentSourceRedirect(
  pathname: string,
  slugs: ContentSlugSets,
): { status: 301; path: string } | { status: 410 } | null {
  const path = decodePath(pathname).toLowerCase();
  if (!path.startsWith("/content/blog/") && !path.startsWith("/content/guides/")) {
    return null;
  }
  const match = CONTENT_FILE.exec(path);
  if (!match) return { status: 410 };
  const section = match[1] as "blog" | "guides";
  const slug = match[3];
  if (!slug) return { status: 410 };
  const known = section === "blog" ? slugs.blog : slugs.guides;
  if (!known.has(slug)) return { status: 410 };
  return { status: 301, path: `/${section}/${slug}` };
}

export function legacySlugRedirect(pathname: string): string | null {
  const path = decodePath(pathname).toLowerCase();
  return LEGACY_PATH_REDIRECTS[path] ?? null;
}

export function indexingAction(input: {
  pathname: string;
  hostname: string;
  rootDomain: string | undefined;
  slugs: ContentSlugSets;
}): IndexingAction | null {
  const content = contentSourceRedirect(input.pathname, input.slugs);
  if (content?.status === 410) return { type: "gone" };
  if (content?.status === 301) {
    return { type: "redirect", path: content.path, preserveSearch: false };
  }
  const legacy = legacySlugRedirect(input.pathname);
  if (legacy) return { type: "redirect", path: legacy, preserveSearch: false };
  if (
    isAppHostname(input.hostname, input.rootDomain) &&
    isAppMarketingPath(input.pathname)
  ) {
    const path = decodePath(input.pathname).toLowerCase();
    return { type: "redirect", path, preserveSearch: true };
  }
  return null;
}

/** Header value for apex utility URLs Google must be allowed to crawl. */
export function marketingNoindexHeader(pathname: string): string | null {
  const path = decodePath(pathname).toLowerCase();
  if (path === "/__manifest") return "noindex";
  if (
    path === "/login" ||
    path === "/signup" ||
    path.startsWith("/signup/") ||
    path === "/forgot-password" ||
    path === "/viewer-access"
  ) {
    return "noindex, follow";
  }
  return null;
}

function matchesDisallow(path: string, rule: string): boolean {
  if (rule.endsWith("/")) return path.startsWith(rule);
  return path === rule || path.startsWith(`${rule}/`);
}

/** Sitemap locs are apex paths that return 200 and are meant to be indexed. */
export function sitemapPathIsIndexable(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.includes("?") || path.includes("#") || path.includes(" ")) return false;
  if (path.endsWith(".md") || path.startsWith("/content/")) return false;
  if (legacySlugRedirect(path)) return false;
  if (marketingNoindexHeader(path)) return false;
  return !ROBOTS_DISALLOW_PATHS.some((rule) => matchesDisallow(path, rule));
}
