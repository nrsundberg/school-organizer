import type { Route } from "./+types/robots.txt";
import { isMarketingHost } from "~/domain/utils/host.server";
import {
  marketingRobotsTxt,
  publicSiteOrigin,
  rootDomainFromContext,
  tenantRobotsTxt,
} from "~/lib/marketing-seo";

export function headers() {
  return { "Cache-Control": "public, max-age=3600" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const body = isMarketingHost(request, context)
    ? marketingRobotsTxt(
        `${publicSiteOrigin(request, rootDomainFromContext(context))}/sitemap.xml`,
      )
    : tenantRobotsTxt();

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
