import type { MiddlewareFunction } from "react-router";
import { listPosts } from "./blog.server";
import { listGuides } from "./guides.server";
import {
  indexingAction,
  type ContentSlugSets,
} from "./indexing";
import { canonicalUrl, publicSiteOrigin, rootDomainFromContext } from "./marketing-seo";

let cachedSlugs: ContentSlugSets | null = null;

function contentSlugs(): ContentSlugSets {
  if (!cachedSlugs) {
    cachedSlugs = {
      blog: new Set(listPosts().map((post) => post.slug)),
      guides: new Set(listGuides().map((guide) => guide.slug)),
    };
  }
  return cachedSlugs;
}

function indexingResponse(request: Request, context: unknown): Response | null {
  const url = new URL(request.url);
  const root = rootDomainFromContext(context);
  const action = indexingAction({
    pathname: url.pathname,
    hostname: url.hostname,
    rootDomain: root,
    slugs: contentSlugs(),
  });
  if (!action) return null;
  if (action.type === "gone") {
    return new Response(null, {
      status: 410,
      headers: {
        "X-Robots-Tag": "noindex",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
  const origin = publicSiteOrigin(request, root);
  const target = new URL(canonicalUrl(origin, action.path));
  if (action.preserveSearch) target.search = url.search;
  return new Response(null, {
    status: 301,
    headers: {
      Location: target.toString(),
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Runs before tenant resolution so the app host can leave marketing URLs. */
export const indexingMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const early = indexingResponse(request, context);
  if (early) return early;
  return next();
};
