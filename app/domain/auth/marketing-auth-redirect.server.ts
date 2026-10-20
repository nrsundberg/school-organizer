import { redirect } from "react-router";
import { getPrisma } from "~/db.server";
import {
  getOptionalUserFromContext,
  getRequestScopeFromContext,
} from "~/domain/utils/global-context.server";
import {
  getPublicEnv,
  isMarketingHost,
  isPlatformAdmin,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import { tenantBoardUrlFromRequest } from "~/lib/org-slug";
import {
  authPageRedirectTarget,
  onboardingSignupPath,
  safeSameSiteTarget,
  signedInHome,
} from "./marketing-auth-redirect";

/**
 * Send a signed-in visitor away from login / sign-up.
 * No-ops for anonymous requests and for the create-school step itself.
 */
export async function redirectSignedInAwayFromAuth(args: {
  request: Request;
  context: any;
  page: "login" | "signup" | "district-signup";
}): Promise<void> {
  const user = getOptionalUserFromContext(args.context);
  if (!user) return;

  const staff = isPlatformAdmin(
    { email: user.email, role: user.role },
    args.context,
  );
  const boardUrl = staff ? null : await activeBoardUrl(args.request, args.context, user.orgId);
  const url = new URL(args.request.url);
  const root = (getPublicEnv(args.context).PUBLIC_ROOT_DOMAIN ?? "").trim();
  const next = safeSameSiteTarget(
    url.searchParams.get("next") ?? url.searchParams.get("redirect"),
    args.request.url,
    root,
  );
  const onMarketing = isMarketingHost(args.request, args.context);
  const target = authPageRedirectTarget({
    page: args.page,
    requestUrl: args.request.url,
    home: signedInHome(user, {
      isPlatformStaff: staff,
      hasBoard: Boolean(boardUrl),
    }),
    boardUrl,
    next,
    onboardingPath: onboardingSignupPath(args.request.url),
    marketingOrigin: marketingOriginFromRequest(args.request, args.context),
    onMarketingHost: onMarketing,
  });
  if (target) throw redirect(target);
}

async function activeBoardUrl(
  request: Request,
  context: any,
  userOrgId: string | null,
): Promise<string | null> {
  const scope = getRequestScopeFromContext(context);
  const impersonated = scope?.impersonation.orgId ?? null;
  const orgId = impersonated || userOrgId;
  if (!orgId) return null;
  const primary = await boardUrlForOrg(request, context, orgId);
  if (primary) return primary;
  if (impersonated && userOrgId && userOrgId !== impersonated) {
    return boardUrlForOrg(request, context, userOrgId);
  }
  return null;
}

async function boardUrlForOrg(
  request: Request,
  context: any,
  orgId: string,
): Promise<string | null> {
  const org = await getPrisma(context).org.findUnique({
    where: { id: orgId },
    select: { slug: true },
  });
  if (!org?.slug) return null;
  return tenantBoardUrlFromRequest(
    request,
    org.slug,
    getPublicEnv(context).PUBLIC_ROOT_DOMAIN,
  );
}
