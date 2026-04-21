import type { Route } from "./+types/billing.cancel";
import { Page } from "~/components/Page";

export function meta() {
  return [{ title: "Checkout canceled — Pickup Roster" }];
}

export async function loader(_: Route.LoaderArgs) {
  return null;
}

export default function BillingCancel() {
  return (
    <Page user={false}>
      <div className="min-h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-xl text-center">
          <h1 className="text-2xl font-semibold mb-3">No charge made</h1>
          <p className="text-white/70 mb-6">
            You backed out of Stripe Checkout before completing the purchase.
            No subscription was created.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/pricing"
              className="inline-block rounded-md bg-white px-5 py-2.5 font-medium text-[#212525] hover:bg-white/90"
            >
              Back to pricing
            </a>
            <a
              href="/admin"
              className="inline-block rounded-md border border-white/30 px-5 py-2.5 font-medium text-white hover:bg-white/10"
            >
              Go to admin
            </a>
          </div>
        </div>
      </div>
    </Page>
  );
}
