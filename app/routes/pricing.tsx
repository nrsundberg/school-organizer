import { Form, Link, useNavigation, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/pricing";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getSupportEmail } from "~/lib/site";
import { SUPPORTED_LANGUAGES } from "~/lib/i18n-config";
import {
  normalizePublicBillingCycle,
  signupPathForPlan,
  type PublicBillingCycle,
  type SelfServeBillingPlan
} from "~/domain/billing/public-plans";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["common", "billing"] };

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Pricing — Pickup Roster" },
    {
      name: "description",
      content:
        data?.metaDescription ??
        "Simple pricing for schools and districts. Pick a plan, create your account, and continue through signup or checkout."
    }
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "billing");
  return {
    supportEmail: getSupportEmail(context),
    billingCycle: normalizePublicBillingCycle(url.searchParams.get("cycle")),
    metaTitle: t("pricing.metaTitle"),
    metaDescription: t("pricing.metaDescription"),
  };
}

type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
};

function CheckoutOrSignupCta({
  billingCycle,
  buttonClassName,
  isCheckoutPending,
  isSignedInOrgAdmin,
  plan,
  signupPlan,
  signupLabel,
  checkoutLabel,
  redirectingLabel
}: {
  billingCycle: PublicBillingCycle;
  buttonClassName: string;
  isCheckoutPending: boolean;
  isSignedInOrgAdmin: boolean;
  plan: SelfServeBillingPlan;
  signupPlan: "car-line" | "campus";
  signupLabel: string;
  checkoutLabel: string;
  redirectingLabel: string;
}) {
  if (!isSignedInOrgAdmin) {
    return (
      <Link
        to={signupPathForPlan(signupPlan, billingCycle)}
        className={buttonClassName}
      >
        {signupLabel}
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
        {isCheckoutPending ? redirectingLabel : checkoutLabel}
      </button>
    </Form>
  );
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation(["billing", "common"]);
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const navigation = useNavigation();
  const isSignedInOrgAdmin = !!rootData?.user?.orgId;
  const { billingCycle, supportEmail } = loaderData;
  const languageCount = SUPPORTED_LANGUAGES.length;

  const priceForCycle = (monthlyPrice: number, cycle: PublicBillingCycle) => {
    if (cycle === "annual") {
      return {
        amount: t("pricing.amount.year", { value: (monthlyPrice * 12).toLocaleString() }),
        period: t("pricing.period.year"),
        note: t("pricing.note.annual"),
      };
    }
    return {
      amount: t("pricing.amount.month", { value: monthlyPrice.toLocaleString() }),
      period: t("pricing.period.month"),
      note: t("pricing.note.monthly"),
    };
  };

  const carLinePrice = priceForCycle(100, billingCycle);
  const campusPrice = priceForCycle(500, billingCycle);
  const isCheckoutPending =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/billing/checkout";
  const cyclePath = (cycle: PublicBillingCycle) =>
    `/pricing?${new URLSearchParams({ cycle }).toString()}`;

  const cycles: PublicBillingCycle[] = ["monthly", "annual"];

  const carLineFeatures = [
    t("pricing.features.carLine.caps"),
    t("pricing.features.carLine.staffViewer"),
    t("pricing.features.carLine.live"),
    t("pricing.features.carLine.brand"),
    t("pricing.features.carLine.support"),
    t("pricing.features.carLine.selfServe"),
  ];

  const campusFeatures = [
    t("pricing.features.campus.everythingCarLine"),
    t("pricing.features.campus.caps"),
    t("pricing.features.campus.reports"),
    t("pricing.features.campus.brand"),
    t("pricing.features.campus.familyApp"),
    t("pricing.features.campus.onboarding"),
    t("pricing.features.campus.sso"),
    t("pricing.features.campus.support"),
    t("pricing.features.campus.rfid"),
  ];

  const districtFeatures = [
    t("pricing.features.district.everythingCampus"),
    t("pricing.features.district.dashboard"),
    t("pricing.features.district.unlimited"),
    t("pricing.features.district.addOn"),
    t("pricing.features.district.rfid"),
  ];

  const signupLabel = t("pricing.cta.continueSignup");
  const checkoutLabel = t("pricing.cta.continueStripe");
  const redirectingLabel = t("pricing.cta.redirecting");

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold">{t("pricing.heading")}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-white/70">
            {t("pricing.lede")}
          </p>
          <p className="mx-auto mt-3 text-sm text-white/55">
            {t("common:marketing.languageCount", { count: languageCount })}{" "}
            {t("common:marketing.everyPlanSuffix")}
          </p>
          <div className="mt-6 inline-flex rounded-full border border-white/15 bg-white/5 p-1 text-sm">
            {cycles.map((cycle) => (
              <Link
                key={cycle}
                to={cyclePath(cycle)}
                className={`rounded-full px-4 py-2 font-semibold transition ${
                  billingCycle === cycle
                    ? "bg-[#E9D500] text-[#193B4B]"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {t(`pricing.cycle.${cycle}`)}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {/* Car Line card — good starting point */}
          <div className="relative flex flex-col rounded-2xl border-2 border-[#F97316]/70 bg-[#F97316]/5 p-6 shadow-2xl shadow-[#F97316]/10">
            <span className="absolute -top-3 left-6 rounded-full bg-[#F97316] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#0f1414]">
              {t("pricing.cards.carLine.badge")}
            </span>
            <h2 className="text-xl font-bold text-[#F97316]">{t("pricing.cards.carLine.name")}</h2>
            <p className="mt-2 text-sm text-white/70">
              {t("pricing.cards.carLine.tagline")}
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
              {carLineFeatures.map((f) => (
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
                signupLabel={signupLabel}
                checkoutLabel={checkoutLabel}
                redirectingLabel={redirectingLabel}
              />
              <p className="mt-3 text-center text-xs text-white/50">
                {isSignedInOrgAdmin
                  ? t("pricing.cardFooter.activateOnly")
                  : t("pricing.cardFooter.createFirst")}
              </p>
            </div>
          </div>

          {/* Campus card — premium single school */}
          <div className="flex flex-col rounded-2xl border border-white/15 bg-[#151a1a] p-6">
            <h2 className="text-xl font-bold">{t("pricing.cards.campus.name")}</h2>
            <p className="mt-2 text-sm text-white/65">
              {t("pricing.cards.campus.tagline")}
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
              {campusFeatures.map((f) => (
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
                signupLabel={signupLabel}
                checkoutLabel={checkoutLabel}
                redirectingLabel={redirectingLabel}
              />
              <p className="mt-3 text-center text-xs text-white/50">
                {isSignedInOrgAdmin
                  ? t("pricing.cardFooter.activateOnly")
                  : t("pricing.cardFooter.createFirst")}
              </p>
            </div>
          </div>

          {/* District card — featured */}
          <div className="relative flex flex-col rounded-2xl border-2 border-[#E9D500]/70 bg-[#193B4B]/40 p-6 shadow-2xl shadow-[#E9D500]/10">
            <span className="absolute -top-3 left-6 rounded-full bg-[#E9D500] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#193B4B]">
              {t("pricing.cards.district.badge")}
            </span>
            <h2 className="text-xl font-bold text-[#E9D500]">{t("pricing.cards.district.name")}</h2>
            <p className="mt-2 text-sm text-white/70">
              {t("pricing.cards.district.tagline")}
            </p>
            <div className="mt-6">
              <p className="text-3xl font-extrabold">{t("pricing.cards.district.amount")}</p>
              <p className="mt-1 text-xs text-white/60">
                {t("pricing.cards.district.amountNote")}
              </p>
            </div>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-white/80">
              {districtFeatures.map((f) => (
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
                  {t("pricing.cards.district.contactCta")}
                </a>
              ) : (
                <Link
                  to={signupPathForPlan("district", billingCycle)}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#E9D500] px-4 py-3 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
                >
                  {t("pricing.cards.district.startTrialCta")}
                </Link>
              )}
              <p className="mt-3 text-center text-xs text-white/70">
                {t("pricing.cards.district.footer")}
              </p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-2xl font-bold">
            {t("pricing.faq.heading")}
          </h2>
          <dl className="mt-8 space-y-6">
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                {t("pricing.faq.creditCard.q")}
              </dt>
              <dd className="mt-2 text-sm text-white/70">{t("pricing.faq.creditCard.a")}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                {t("pricing.faq.afterTrial.q")}
              </dt>
              <dd className="mt-2 text-sm text-white/70">
                {t("pricing.faq.afterTrial.a")}
              </dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#151a1a] p-5">
              <dt className="text-base font-semibold text-white">
                {t("pricing.faq.switchTiers.q")}
              </dt>
              <dd className="mt-2 text-sm text-white/70">
                {t("pricing.faq.switchTiers.a")}
              </dd>
            </div>
          </dl>

          {/* Hardship-pricing note. Intentionally untranslated for v1 — */}
          {/* sales conversation, not core marketing copy. */}
          <aside className="mt-12 rounded-xl border border-blue-400/30 bg-blue-400/5 p-5 text-sm text-white/80">
            <h3 className="mb-1 font-semibold text-white">
              Mid-year sign-ups &amp; small private schools
            </h3>
            <p>
              Joining mid-school-year, or running a small private school
              where the listed pricing isn&rsquo;t workable? Mention it
              during your free trial — our team will work with you on
              pricing.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
