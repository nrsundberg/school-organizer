import type { Route } from "./+types/content-source";
import { listPosts } from "~/lib/blog.server";
import { listGuides } from "~/lib/guides.server";
import { contentSourceRedirect } from "~/lib/indexing";
import {
  canonicalUrl,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";

/**
 * Root middleware only runs after a route matches. `/content/...md` matched
 * nothing, so those requests 404'd before the redirect could run. This route
 * exists so the matcher reaches the redirect.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const decision = contentSourceRedirect(url.pathname, {
    blog: new Set(listPosts().map((post) => post.slug)),
    guides: new Set(listGuides().map((guide) => guide.slug)),
  });
  if (decision?.status === 301) {
    const origin = publicSiteOrigin(request, rootDomainFromContext(context));
    return new Response(null, {
      status: 301,
      headers: {
        Location: canonicalUrl(origin, decision.path),
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
  return new Response(null, {
    status: 410,
    headers: {
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
