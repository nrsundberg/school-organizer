import { Form, Link, useRouteLoaderData } from "react-router";
import { Page } from "~/components/Page";
import type { Route } from "./+types/billing-required";
import {
  getOptionalOrgFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";

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
  const suspended = loaderData.orgStatus === "SUSPENDED";
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const supportEmail = rootData?.supportEmail ?? "support@pickuproster.com";

  return (
    <Page user={!!loaderData.user}>
      <div className="h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold mb-3">
            {suspended ? "Account suspended" : "Billing Action Required"}
          </h1>
          <p className="text-white/70 mb-4">
            {suspended
              ? "This organization was suspended after extended non-payment. Update your payment method and pay any outstanding invoice to restore access."
              : "Your organization billing status is not active. Update the subscription to regain full app access."}
          </p>
          {!suspended && (
            <p className="text-sm text-white/50 mb-6">
              If you are on the free plan, contact support to re-activate your org.
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-4">
            {loaderData.hasStripeCustomer && (
              <Form method="post" action="/api/billing/portal">
                <button
                  type="submit"
                  className="rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
                >
                  Update payment method
                </button>
              </Form>
            )}
            <Link
              to="/pricing"
              className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Choose a plan
            </Link>
          </div>

          <p className="mt-6 text-sm text-white/70">
            Need help?{" "}
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
