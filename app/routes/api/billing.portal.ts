import { data, redirect } from "react-router";
import { redirectWithError } from "remix-toast";
import type { Route } from "./+types/billing.portal";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { createBillingPortalSessionForOrg } from "~/domain/billing/checkout.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user || !user.orgId) {
    return redirectWithError("/login", "Sign in to continue.");
  }

  // Rate limit by orgId (preferred) or client IP
  const clientIp = clientIpFromRequest(request);
  const rlResult = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_BILLING"),
    key: "billing:" + (user.orgId ?? clientIp),
  });
  if (!rlResult.ok) {
    return data(
      { error: "Too many attempts. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/admin/billing`;

    const { url } = await createBillingPortalSessionForOrg({
      context,
      orgId: user.orgId,
      returnUrl,
    });

    throw redirect(url);
  } catch (error) {
    if (error instanceof Response) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Could not open the billing portal.";
    return redirectWithError("/admin/billing", message);
  }
}
