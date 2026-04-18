import { Page } from "~/components/Page";
import type { Route } from "./+types/billing-required";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function loader({ context }: Route.LoaderArgs) {
  return { user: getOptionalUserFromContext(context) };
}

export default function BillingRequired({ loaderData }: Route.ComponentProps) {
  return (
    <Page user={!!loaderData.user}>
      <div className="h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold mb-3">Billing Action Required</h1>
          <p className="text-white/70 mb-4">
            Your organization billing status is not active. Update the subscription to
            regain full app access.
          </p>
          <p className="text-sm text-white/50">
            If you are on the free plan, contact support to re-activate your org.
          </p>
        </div>
      </div>
    </Page>
  );
}

