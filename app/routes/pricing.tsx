import { Form, Link, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/pricing";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getSupportEmail } from "~/lib/site";
import {
  billingCycleLabel,
  normalizePublicBillingCycle,
  signupPathForPlan,
  type PublicBillingCycle,
  type SelfServeBillingPlan
} from "~/domain/billing/public-plans";

export function meta() {
  return [
    { title: "Pricing — Pickup Roster" },
    {
      name: "description",
      content:
        "Simple pricing for schools and districts. Pick a plan, create your account, and continue through signup or checkout."
    }
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return {
    supportEmail: getSupportEmail(context),
    billingCycle: normalizePublicBillingCycle(url.searchParams.get("cycle"))
  };
}

type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
};

const CAR_LINE_FEATURES = [
  "Up to 150 families, 400 students, 35 classrooms",
  "Teacher & staff viewer only (no parent or family app)",
  "Live dismissal / car-line flow",
  "Pick your brand colors (no logo upload)",
  "Standard email support",
  "Self-serve monthly or annual billing"
];

const CAMPUS_FEATURES = [
  "Everything in Car Line",
  "Up to 300 families, 900 students, 80 classrooms",
  "Reports and call history",
  "Full custom branding — logo upload + custom domain",
  "Parent & family viewer app",
  "Dedicated migration & onboarding support",
  "Microsoft Entra SSO (coming soon)",
  "Priority support",
  "RFID vehicle-tag auto-arrival available as a custom add-on (pricing scoped per deployment)"
];

const DISTRICT_FEATURES = [
  "Everything in Campus",
  "Multi-school dashboard (up to 10 schools included)",
  "Unlimited students, families, and classrooms",
  "Additional schools available as an add-on",
  "RFID vehicle-tag auto-arrival available as a custom add-on (pricing scoped per deployment)"
];

function priceForCycle(monthlyPrice: number, billingCycle: PublicBillingCycle) {
  if (billingCycle === "annual") {
    return {
      amount: `$${(monthlyPrice * 12).toLocaleString()}`,
      period: "/ year",
      note: "per school, billed annually"
    };
  }

  return {
    amount: `$${monthlyPrice.toLocaleString()}`,
    period: "/ month",
    note: "per school"
  };
}

function CheckoutOrSignupCta({
  billingCycle,
  buttonClassName,
  isCheckoutPending,
  isSignedInOrgAdmin,
  plan,
  signupPlan
}: {
  billingCycle: PublicBillingCycle;
  buttonClassName: string;
  isCheckoutPending: boolean;
  isSignedInOrgAdmin: boolean;
  plan: SelfServeBillingPlan;
  signupPlan: "car-line" | "campus";
}) {
  if (!isSignedInOrgAdmin) {
    return (
      <Link
        to={signupPathForPlan(signupPlan, billingCycle)}
        className={buttonClassName}
      >
        Continue to Signup
      </Link>
    );
  }

  return (
    <Form method="post" action="/api/billing/checkout">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="billingCycle" value={billingCycle} />
      <button
        type="submit"
        disabled={isCheckoutPending}
        className={buttonClassName}
      >
        {isCheckoutPending ? "Redirecting..." : "Continue to Stripe"}
      </button>
    </Form>
  );
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const navigation = useNavigation();
  const isSignedInOrgAdmin = !!rootData?.user?.orgId;
  const { billingCycle, supportEmail } = loaderData;
  const carLinePrice = priceForCycle(100, billingCycle);
  const campusPrice = priceForCycle(500, billingCycle);
  const isCheckoutPending =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/billing/checkout";
  const cyclePath = (cycle: PublicBillingCycle) =>
    `/pricing?${new URLSearchParams({ cycle }).toString()}`;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold">Pricing</h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-white/70">
            Pick the tier that matches your school or district, then continue
            through signup. Self-serve plans can move straight into checkout,
            and district setups stay custom.
          </p>
          <div className="mt-6 inline-flex rounded-full border border-white/15 bg-white/5 p-1 text-sm">
            {(["monthly", "annual"] as const).map((cycle) => (
              <Link
                key={cycle}
                to={cyclePath(cycle)}
                className={`rounded-full px-4 py-2 font-semibold transition ${
                  billingCycle === cycle
                    ? "bg-[#E9D500] text-[#193B4B]"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {billingCycleLabel(cycle)}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {/* Car Line card — good starting point */}
          <div className="relative flex flex-col rounded-2xl border-2 border-[#F97316]/70 bg-[#F97316]/5 p-6 shadow-2xl shadow-[#F97316]/10">
            <span className="absolute -top-3 left-6 rounded-full bg-[#F97316] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#0f1414]">
              A good starting point
            </span>
            <h2 className="text-xl font-bold text-[#F97316]">Car Line</h2>
            <p className="mt-2 text-sm text-white/70">
              Run dismissal smoothly with a staff-only viewer. Best for smaller
              schools.
            </p>
            <div className="mt-6">
              <p className="text-3xl font-extrabold">
                {carLinePrice.amount}{" "}
                <span className="text-base font-semibold text-white/60">
                  {carLinePrice.period}
                </span>
              </p>
              <p className="mt-1 text-xs text-white/50">{carLinePrice.note}</p>
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-white/80">
              {CAR_LINE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-[#F97316]">
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <CheckoutOrSignupCta
                billingCycle={billingCycle}
                buttonClassName="inline-flex w-full items-center justify-center rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                isCheckoutPending={isCheckoutPending}
                isSignedInOrgAdmin={isSignedInOrgAdmin}
                plan="CAR_LINE"
                signupPlan="car-line"
              />
              <p className="mt-3 text-center text-xs text-white/50">
                {isSignedInOrgAdmin
                  ? "Stripe Checkout opens only when you choose to activate billing."
                  : "Create your account first, then continue to Stripe Checkout."}
              </p>
            </div>
          </div>

          {/* Campus card — premium single school */}
          <div className="flex flex-col rounded-2xl border border-white/15 bg-[#151a1a] p-6">
            <h2 className="text-xl font-bold">Campus</h2>
            <p className="mt-2 text-sm text-white/65">
              Premium tier for a single school — adds the parent & family app,
              higher caps, and dedicated support.
            </p>
            <div className="mt-6">
              <p className="text-3xl font-extrabold">
                {campusPrice.amount}{" "}
                <span className="text-base font-semibold text-white/60">
                  {campusPrice.period}
                </span>
              </p>
              <p className="mt-1 text-xs text-white/50">{campusPrice.note}</p>
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-white/80">
              {CAMPUS_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-[#E9D500]">
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <CheckoutOrSignupCta
                billingCycle={billingCycle}
                buttonClassName="inline-flex w-full items-center justify-center rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                isCheckoutPending={isCheckoutPending}
                isSignedInOrgAdmin={isSignedInOrgAdmin}
                plan="CAMPUS"
                signupPlan="campus"
              />
              <p className="mt-3 text-center text-xs text-white/50">
                {isSignedInOrgAdmin
                  ? "Stripe Checkout opens only when you choose to activate billing."
                  : "Create your account first, then continue to Stripe Checkout."}
              </p>
            </div>
          </div>

          {/* District card — featured */}
          <div className="relative flex flex-col rounded-2xl border-2 border-[#E9D500]/70 bg-[#193B4B]/40 p-6 shadow-2xl shadow-[#E9D500]/10">
            <span className="absolute -top-3 left-6 rounded-full bg-[#E9D500] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#193B4B]">
              Recommended for districts
            </span>
            <h2 className="text-xl font-bold text-[#E9D500]">District</h2>
            <p className="mt-2 text-sm text-white/70">
              For districts running more than one school.
            </p>
            <div className="mt-6">
              <p className="text-3xl font-extrabold">Custom pricing</p>
              <p className="mt-1 text-xs text-white/60">
                Up to 10 schools included
              </p>
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-white/80">
              {DISTRICT_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-[#E9D500]">
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {isSignedInOrgAdmin ? (
                <a
                  href={`mailto:${supportEmail}?subject=District%20pricing`}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#E9D500] px-4 py-3 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
                >
                  Contact us
                </a>
              ) : (
                <Link
                  to={signupPathForPlan("district", billingCycle)}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#E9D500] px-4 py-3 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
                >
                  Start Free Trial
                </Link>
              )}
              <p className="mt-3 text-center text-xs text-white/70">
                No credit card required. We&apos;ll reach out during your trial
                to discuss your district&apos;s setup.
              </p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-2xl font-bold">
            Questions, answered
          </h2>
          <dl className="mt-8 space-y-6">
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                Do I need a credit card to start?
              </dt>
              <dd className="mt-2 text-sm text-white/70">No.</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                What happens after 30 days?
              </dt>
              <dd className="mt-2 text-sm text-white/70">
                If you haven&apos;t converted, your site is suspended. No
                surprise charges.
              </dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                Can I switch tiers?
              </dt>
              <dd className="mt-2 text-sm text-white/70">
                Yes, contact us to upgrade or downgrade anytime.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
