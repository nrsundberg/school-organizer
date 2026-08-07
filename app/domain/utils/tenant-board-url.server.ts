import { getPrisma } from "~/db.server";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import { getOptionalUserFromContext } from "./global-context.server";
import { getPublicEnv } from "./host.server";

/** Board URL for the signed-in user's org, or null if no org / no slug. */
export async function getTenantBoardUrlForRequest(
  request: Request,
  context: any,
): Promise<string | null> {
  const user = getOptionalUserFromContext(context);
  if (!user?.orgId) return null;
  const db = getPrisma(context);
  const org = await db.org.findUnique({
    where: { id: user.orgId },
    select: { slug: true },
  });
  if (!org?.slug) return null;
  // Pass the configured root so the board host is built from the root rather
  // than from the request's host — otherwise signing in at tome.pickuproster.com
  // redirects to tome.tome.pickuproster.com.
  return tenantBoardUrlFromRequest(
    request,
    org.slug,
    getPublicEnv(context).PUBLIC_ROOT_DOMAIN,
  );
}
