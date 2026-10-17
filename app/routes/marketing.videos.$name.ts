import type { Route } from "./+types/marketing.videos.$name";
import {
  marketingVideoObjectKey,
  serveMarketingVideo,
  type MarketingVideoBucket,
} from "~/lib/marketing-video.server";

/**
 * Public marketing demo videos. Objects live in the private
 * ORG_BRANDING_BUCKET under `marketing/videos/` — the bucket is not public,
 * and this route never reads any other prefix (tenant logos included).
 *
 * Reachable without auth on marketing and tenant hosts; see
 * `isMarketingVideo` in the request-scope classifier.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const objectKey = marketingVideoObjectKey(params.name);
  if (!objectKey) {
    return new Response("Not found", { status: 404 });
  }

  const bucket = (context as { cloudflare?: { env?: Env } }).cloudflare?.env
    ?.ORG_BRANDING_BUCKET as MarketingVideoBucket | undefined;
  if (!bucket) {
    return new Response("Not found", { status: 404 });
  }

  return serveMarketingVideo({
    bucket,
    objectKey,
    method: request.method,
    rangeHeader: request.headers.get("Range"),
  });
}
