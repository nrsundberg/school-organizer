import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/billing";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOptionalOrgFromContext } from "~/domain/utils/global-context.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Billing — Admin" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOptionalOrgFromContext(context);

  // Schools inside a district don't manage their own billing — billing is
  // owned by the district at /district/billing.
  if (org?.districtId) {
    throw redirect("/admin");
  }

  const now = new Date();
  const trialDaysRemaining =
    org?.trialEndsAt && org.status === "TRIALING"
      ? Math.max(0, Math.ceil((new Date(org.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

  const isComped =
    !!org?.compedUntil && new Date(org.compedUntil) > now;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  return {
    metaTitle: t("billing.metaTitle"),
    org: org
      ? {
          id: org.id,
          name: org.name,
          billingPlan: org.billingPlan,
          status: org.status,
          subscriptionStatus: org.subscriptionStatus,
          trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
          compedUntil: org.compedUntil?.toISOString() ?? null,
          hasStripeCustomer: !!org.stripeCustomerId,
        }
      : null,
    trialDaysRemaining,
    isComped,
  };
}

export default function AdminBilling({ loaderData }: Route.ComponentProps) {
  const { org, trialDaysRemaining, isComped } = loaderData;
  const { t, i18n } = useTranslation("admin");
  const navigation = useNavigation();
  const isPortalPending =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/billing/portal";

  const isPaidPlan = org?.billingPlan === "CAR_LINE" || org?.billingPlan === "CAMPUS";
  const canManageBilling = isPaidPlan && org?.hasStripeCustomer;

  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">{t("billing.heading")}</h1>

      {isComped && org?.compedUntil && (
        <div className="rounded-xl border border-[#E9D500]/40 bg-[#E9D500]/10 p-4">
          <p className="text-sm font-semibold text-[#E9D500]">
            {t("billing.compedTitle")}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {t("billing.compedBody", {
              date: new Date(org.compedUntil).toLocaleDateString(i18n.language, {
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
            })}
          </p>
        </div>
      )}

      {/* Plan & Status panel */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          {t("billing.currentPlan")}
        </h2>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-white/50">{t("billing.plan")}</dt>
            <dd className="font-semibold text-white">{org?.billingPlan ?? t("billing.dash")}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-white/50">{t("billing.orgStatus")}</dt>
            <dd>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  org?.status === "ACTIVE"
                    ? "bg-green-500/20 text-green-300"
                    : org?.status === "TRIALING"
                      ? "bg-blue-500/20 text-blue-300"
                      : org?.status === "PAST_DUE"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-red-500/20 text-red-300"
                }`}
              >
                {org?.status ?? t("billing.dash")}
              </span>
            </dd>
          </div>
          {org?.subscriptionStatus && (
            <div className="flex items-center justify-between">
              <dt className="text-white/50">{t("billing.subscriptionStatus")}</dt>
              <dd className="text-white">{org.subscriptionStatus}</dd>
            </div>
          )}
          {trialDaysRemaining !== null && (
            <div className="flex items-center justify-between">
              <dt className="text-white/50">{t("billing.trialDaysRemaining")}</dt>
              <dd className="text-white">
                {t("billing.trialDays", { count: trialDaysRemaining })}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        {canManageBilling ? (
          <Form method="post" action="/api/billing/portal">
            <button
              type="submit"
              disabled={isPortalPending}
              className="rounded-xl bg-[#E9D500] px-5 py-2.5 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047] disabled:opacity-50"
            >
              {isPortalPending ? t("billing.redirecting") : t("billing.manageBilling")}
            </button>
          </Form>
        ) : (
          <Link
            to="/pricing"
            className="inline-flex rounded-xl bg-[#E9D500] px-5 py-2.5 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
          >
            {t("billing.upgradePlan")}
          </Link>
        )}
        {canManageBilling && (
          <Link
            to="/pricing"
            className="inline-flex rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            {t("billing.viewPlans")}
          </Link>
        )}
      </div>

      <p className="text-xs text-white/65">
        {t("billing.footer")}
      </p>
    </div>
  );
}
