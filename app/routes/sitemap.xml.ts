import type { Route } from "./+types/sitemap.xml";
import { isMarketingHost } from "~/domain/utils/host.server";
import { listPosts } from "~/lib/blog.server";
import { listGuides } from "~/lib/guides.server";
import {
  buildSitemapXml,
  publicSiteOrigin,
  rootDomainFromContext,
  SITEMAP_PATH_LASTMOD,
  SITEMAP_STATIC_PATHS,
  type SitemapEntry,
} from "~/lib/marketing-seo";

export function headers() {
  return { "Cache-Control": "public, max-age=3600" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw new Response("Not found", { status: 404 });
  }

  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  const entries: SitemapEntry[] = [
    ...SITEMAP_STATIC_PATHS.map((path) => ({
      path,
      lastmod: SITEMAP_PATH_LASTMOD[path],
    })),
    ...listPosts().map((post) => ({
      path: `/blog/${post.slug}`,
      lastmod: post.date,
    })),
    ...listGuides().map((guide) => ({
      path: `/guides/${guide.slug}`,
      lastmod: guide.date,
    })),
  ];

  return new Response(buildSitemapXml(origin, entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
