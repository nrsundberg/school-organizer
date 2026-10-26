import type { Route } from "./+types/robots.txt";
import { isMarketingHost } from "~/domain/utils/host.server";
import { isAppHostname } from "~/lib/indexing";
import {
  appHostRobotsTxt,
  marketingRobotsTxt,
  publicSiteOrigin,
  rootDomainFromContext,
  tenantRobotsTxt,
} from "~/lib/marketing-seo";

export function headers() {
  return { "Cache-Control": "public, max-age=3600" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  const sitemapUrl = `${origin}/sitemap.xml`;
  const host = new URL(request.url).hostname;
  const body = isMarketingHost(request, context)
    ? marketingRobotsTxt(sitemapUrl)
    : isAppHostname(host, rootDomainFromContext(context))
      ? appHostRobotsTxt(sitemapUrl)
      : tenantRobotsTxt();

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
