import { Form, Link, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { Page } from "~/components/Page";
import type { Route } from "./+types/billing-required";
import {
  getOptionalOrgFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";

export const handle = { i18n: ["auth"] };

export async function loader({ context }: Route.LoaderArgs) {
  const org = getOptionalOrgFromContext(context);
  return {
    user: getOptionalUserFromContext(context),
    orgStatus: org?.status ?? null,
    hasStripeCustomer: !!org?.stripeCustomerId,
  };
}

type RootLoader = {
  supportEmail?: string;
};

export default function BillingRequired({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const suspended = loaderData.orgStatus === "SUSPENDED";
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const supportEmail = rootData?.supportEmail ?? "support@pickuproster.com";

  return (
    <Page user={!!loaderData.user}>
      <div className="h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold mb-3">
            {suspended ? t("billingRequired.titleSuspended") : t("billingRequired.titleAction")}
          </h1>
          <p className="text-white/70 mb-4">
            {suspended
              ? t("billingRequired.bodySuspended")
              : t("billingRequired.bodyAction")}
          </p>
          {!suspended && (
            <p className="text-sm text-white/50 mb-6">
              {t("billingRequired.freePlanNote")}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-4">
            {loaderData.hasStripeCustomer && (
              <Form method="post" action="/api/billing/portal">
                <button
                  type="submit"
                  className="rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
                >
                  {t("billingRequired.updatePayment")}
                </button>
              </Form>
            )}
            <Link
              to="/pricing"
              className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              {t("billingRequired.choosePlan")}
            </Link>
          </div>

          <p className="mt-6 text-sm text-white/70">
            {t("billingRequired.needHelp")}{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="text-[#E9D500] hover:underline"
            >
              {supportEmail}
            </a>
          </p>
        </div>
      </div>
    </Page>
  );
}
