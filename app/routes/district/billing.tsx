import { Form } from "react-router";
import type { Route } from "./+types/billing";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import {
  getDistrictById,
  getDistrictSchoolCount,
} from "~/domain/district/district.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schoolCount] = await Promise.all([
    getDistrictById(context, districtId),
    getDistrictSchoolCount(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district, schoolCount };
}

export default function DistrictBilling({ loaderData }: Route.ComponentProps) {
  const { district, schoolCount } = loaderData;
  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Billing</h2>
        <p className="text-sm text-white/50">
          One bill for the whole district. Per-school billing is disabled
          inside the district.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
        <dt className="text-white/50">Plan</dt>
        <dd>{district.billingPlan}</dd>
        <dt className="text-white/50">Status</dt>
        <dd>{district.status}</dd>
        <dt className="text-white/50">Schools</dt>
        <dd>
          {schoolCount} of {district.schoolCap}
        </dd>
        <dt className="text-white/50">Trial ends</dt>
        <dd>
          {district.trialEndsAt
            ? new Date(district.trialEndsAt).toLocaleDateString()
            : "Not set"}
        </dd>
      </dl>
      {district.stripeCustomerId ? (
        <Form method="post" action="/district/billing/portal">
          <button
            type="submit"
            className="rounded-lg bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
          >
            Open Stripe portal
          </button>
        </Form>
      ) : (
        <p className="text-sm text-white/60">
          Your account isn&rsquo;t connected to Stripe yet. Your account
          manager will reach out to finalize pricing during your trial.
        </p>
      )}
      <p className="text-xs text-white/40">
        Need to add or remove schools? Contact your account manager.
      </p>
    </section>
  );
}
