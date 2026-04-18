import { data } from "react-router";
import type { Route } from "./+types/branding.logo.$slug";
import { getPrisma } from "~/db.server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    return data("Not found", { status: 404 });
  }

  const db = getPrisma(context);
  const org = await db.org.findUnique({
    where: { slug },
    select: { logoObjectKey: true },
  });
  if (!org?.logoObjectKey) {
    return data("Not found", { status: 404 });
  }

  const bucket = (context as any).cloudflare?.env?.ORG_BRANDING_BUCKET as R2Bucket | undefined;
  if (!bucket) {
    return data("Logo storage is not configured", { status: 503 });
  }

  const object = await bucket.get(org.logoObjectKey);
  if (!object) {
    return data("Not found", { status: 404 });
  }

  const headers = new Headers();
  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}
