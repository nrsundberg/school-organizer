import { redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/billing.success";
import { Page } from "~/components/Page";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { requireStripeConfig } from "~/domain/billing/stripe.server";
import { applySubscriptionToOrg } from "~/domain/billing/sync.server";
import type Stripe from "stripe";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["common"] };

export function meta({ data }: { data?: { metaTitle?: string } }) {
  return [{ title: data?.metaTitle ?? "Upgrade complete — Pickup Roster" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user || !user.orgId) {
    throw redirect("/login");
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    throw redirect("/admin/billing");
  }

  const stripe = requireStripeConfig(context);
  const session = await stripe.client.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer"],
  });

  const db = getPrisma(context);
  const org = await db.org.findUnique({ where: { id: user.orgId } });
  if (!org) {
    throw new Response("Org not found.", { status: 404 });
  }

  const metaOrgId = session.metadata?.orgId ?? null;
  const sessionCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer && "id" in session.customer
        ? session.customer.id
        : null;

  const matchesByMeta = metaOrgId ? metaOrgId === user.orgId : false;
  const matchesByCustomer =
    !!org.stripeCustomerId &&
    !!sessionCustomerId &&
    sessionCustomerId === org.stripeCustomerId;

  if (!matchesByMeta && !matchesByCustomer) {
    throw new Response("Forbidden.", { status: 403 });
  }

  const subscription = session.subscription;
  if (subscription && typeof subscription !== "string") {
    await applySubscriptionToOrg(context, subscription as Stripe.Subscription);
  } else if (typeof subscription === "string") {
    const expanded = await stripe.client.subscriptions.retrieve(subscription);
    await applySubscriptionToOrg(context, expanded);
  }

  const refreshed = await db.org.findUnique({ where: { id: user.orgId } });

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");

  return {
    orgName: refreshed?.name ?? org.name,
    plan: refreshed?.billingPlan ?? org.billingPlan,
    metaTitle: t("billing.success.metaTitle"),
  };
}

export default function BillingSuccess({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { orgName, plan } = loaderData;
  const planLabel =
    plan === "CAR_LINE"
      ? t("billing.success.planNames.carLine")
      : plan === "CAMPUS"
        ? t("billing.success.planNames.campus")
        : plan === "ENTERPRISE"
          ? t("billing.success.planNames.enterprise")
          : t("billing.success.planNames.free");

  return (
    <Page user={true}>
      <div className="min-h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-xl text-center">
          <h1 className="text-3xl font-semibold mb-3">
            {t("billing.success.title", { plan: planLabel })}
          </h1>
          <p className="text-white/70 mb-6">
            {t("billing.success.body", { orgName, plan: planLabel })}
          </p>
          <a
            href="/admin"
            className="inline-block rounded-md bg-white px-5 py-2.5 font-medium text-[#212525] hover:bg-white/90"
          >
            {t("billing.success.goToAdmin")}
          </a>
        </div>
      </div>
    </Page>
  );
}
