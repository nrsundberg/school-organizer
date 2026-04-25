import { data, redirect } from "react-router";
import { redirectWithError } from "remix-toast";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { Route } from "./+types/billing.checkout";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { createCheckoutSessionForOrg } from "~/domain/billing/checkout.server";
import { pricingPathForPlan } from "~/domain/billing/public-plans";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import { detectLocale } from "~/i18n.server";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

const checkoutSchema = zfd.formData({
  plan: zfd.text(z.enum(["CAR_LINE", "CAMPUS"])),
  billingCycle: zfd.text(z.enum(["monthly", "annual"]).optional()),
});

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

  const formData = await request.formData();
  const parsed = checkoutSchema.safeParse(formData);
  if (!parsed.success) {
    return data(
      { error: "Select a valid plan to continue." },
      { status: 400 },
    );
  }
  const { plan, billingCycle } = parsed.data;

  try {
    const origin = new URL(request.url).origin;
    const successUrl = `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/billing/cancel`;

    const prisma = getPrisma(context);
    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    const email = userRow?.email ?? "";

    // Forward the request locale so Stripe-hosted Checkout localizes its UI.
    const locale = await detectLocale(request, context);

    const { url } = await createCheckoutSessionForOrg({
      context,
      orgId: user.orgId,
      plan,
      billingCycle: billingCycle ?? "monthly",
      email,
      successUrl,
      cancelUrl,
      locale,
    });

    throw redirect(url);
  } catch (error) {
    if (error instanceof Response) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Could not start Stripe Checkout.";
    return redirectWithError(pricingPathForPlan(plan, billingCycle ?? "monthly"), message);
  }
}
