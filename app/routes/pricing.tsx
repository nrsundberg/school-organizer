import { Link } from "react-router";
import type { Route } from "./+types/pricing";
import { MarketingNav } from "~/components/marketing/MarketingNav";

export function meta() {
  return [
    { title: "Pricing — School Organizer" },
    { name: "description", content: "Simple pricing for car line and school operations." },
  ];
}

export async function loader() {
  return null;
}

export default function Pricing() {
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">Pricing</h1>
        <p className="mt-3 text-lg text-white/70">
          Start with a free trial. Upgrade when you need billing and higher limits.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6">
            <h2 className="text-xl font-bold">Free trial</h2>
            <p className="mt-2 text-sm text-white/65">
              Full board experience on your school subdomain. Trial length follows your usage: 30 calendar days and 25
              qualifying pickup days—whichever ends later.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/75">
              <li>✓ Live board + viewer PINs</li>
              <li>✓ Homeroom filters and call history</li>
              <li>✓ School-scoped data isolation</li>
            </ul>
            <Link
              to="/signup"
              className="mt-6 inline-flex rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
            >
              Start trial
            </Link>
          </div>

          <div className="rounded-2xl border border-[#E9D500]/40 bg-[#193B4B]/40 p-6">
            <h2 className="text-xl font-bold text-[#E9D500]">Starter</h2>
            <p className="mt-2 text-sm text-white/65">
              Paid plan with Stripe billing for schools that need subscription management and support readiness.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/75">
              <li>✓ Everything in trial</li>
              <li>✓ Stripe-backed subscription</li>
              <li>✓ Webhook-driven status updates</li>
            </ul>
            <Link
              to="/signup"
              className="mt-6 inline-flex rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
            >
              Sign up — choose Starter
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
