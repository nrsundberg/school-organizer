import { getPrisma } from "~/db.server";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import { getOptionalUserFromContext } from "./global-context.server";

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
  return tenantBoardUrlFromRequest(request, org.slug);
}
