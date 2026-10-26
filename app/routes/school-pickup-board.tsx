import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/school-pickup-board";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import { detectLocale } from "~/i18n.server";
import { schoolPickupBoardCopy } from "~/lib/school-pickup-board-copy";
import {
  canonicalUrl,
  faqPageJsonLd,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
  softwareApplicationJsonLd,
} from "~/lib/marketing-seo";

const GUIDES = [
  {
    href: "/guides/importing-student-rosters-from-sis",
    en: "Import a student roster",
    es: "Importa la lista de estudiantes",
  },
  {
    href: "/guides/configuring-pickup-zones-and-lane-assignments",
    en: "Set up pickup zones and lanes",
    es: "Configura zonas y carriles",
  },
  {
    href: "/guides/setting-up-your-first-drill-template",
    en: "Set up a drill template",
    es: "Configura una plantilla de simulacro",
  },
  {
    href: "/blog/privacy-and-ferpa-in-pickup-logistics",
    en: "Privacy and pickup records",
    es: "Privacidad y registros de recogida",
  },
  {
    href: "/blog/diagnose-car-line-wait-times-before-the-first-bell",
    en: "Diagnose car-line wait times",
    es: "Diagnostica los tiempos de espera",
  },
] as const;

const COMPARE = [
  {
    href: "/compare/pikmykid-alternatives",
    en: "PikMyKid alternatives",
    es: "Alternativas a PikMyKid",
  },
  {
    href: "/compare/schoolpass-vs-pickuproster",
    en: "SchoolPass vs PickupRoster",
    es: "SchoolPass y PickupRoster",
  },
  {
    href: "/blog/best-school-dismissal-software",
    en: "Best school dismissal software",
    es: "El mejor software de salida escolar",
  },
] as const;

export const handle = { i18n: ["common"] };

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "https://pickuproster.com";
  const title =
    data?.copy.metaTitle ??
    "School Pickup Board & Dismissal Display | PickupRoster";
  const description =
    data?.copy.metaDescription ??
    "A live, browser-based school pickup board. Free 30-day trial, no card.";
  return marketingPageMeta({
    title,
    description,
    canonical: data?.canonical ?? canonicalUrl(origin, "/school-pickup-board"),
    origin,
    image: true,
    jsonLd: data
      ? [softwareApplicationJsonLd(origin), faqPageJsonLd(data.copy.faqs)]
      : undefined,
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(
      `${marketingOriginFromRequest(request, context)}/school-pickup-board`,
    );
  }
  const locale = await detectLocale(request, context);
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  return {
    origin,
    canonical: canonicalUrl(origin, "/school-pickup-board"),
    copy: schoolPickupBoardCopy(locale),
    locale,
  };
}

const yellowButton =
  "inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] shadow-lg shadow-[#E9D500]/20 transition hover:bg-[#f5e047]";
const ghostButton =
  "inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-base font-semibold text-white/90 transition hover:border-white/40";

export default function SchoolPickupBoard({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { copy, locale } = loaderData;
  const spanish = locale.startsWith("es");

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#E9D500]">
            {copy.kicker}
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight md:text-5xl">
            {copy.h1}
          </h1>
          <p className="mt-5 text-lg text-white/70">{copy.subhead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo" className={yellowButton}>
              {copy.bookDemo}
            </Link>
            <Link to="/signup?plan=car-line" className={ghostButton}>
              {copy.startTrial}
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold">{copy.problemTitle}</h2>
        <ul className="mt-6 space-y-3 text-white/75">
          {copy.problems.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-[#E9D500]">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold">{copy.howTitle}</h2>
          <ol className="mt-8 space-y-6">
            {copy.steps.map((step, index) => (
              <li key={step.title}>
                <h3 className="text-lg font-semibold text-[#E9D500]">
                  {index + 1}. {step.title}
                </h3>
                <p className="mt-2 text-white/75">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold">{copy.whyTitle}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {copy.reasons.map((reason) => (
            <div
              key={reason.title}
              className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
            >
              <h3 className="font-semibold">{reason.title}</h3>
              <p className="mt-2 text-sm text-white/70">{reason.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold">{copy.moreTitle}</h2>
          <ul className="mt-6 space-y-3 text-white/75">
            {copy.more.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3 className="mt-10 text-lg font-semibold">
            {spanish ? "Guías relacionadas" : "Related guides"}
          </h3>
          <ul className="mt-4 space-y-2">
            {GUIDES.map((guide) => (
              <li key={guide.href}>
                <Link
                  to={guide.href}
                  className="text-[#E9D500] underline hover:text-[#f5e047]"
                >
                  {spanish ? guide.es : guide.en}
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="mt-10 text-lg font-semibold">
            {spanish ? "Comparar opciones" : "Compare options"}
          </h3>
          <ul className="mt-4 space-y-2">
            {COMPARE.map((page) => (
              <li key={page.href}>
                <Link
                  to={page.href}
                  className="text-[#E9D500] underline hover:text-[#f5e047]"
                >
                  {spanish ? page.es : page.en}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold">{copy.pricingTitle}</h2>
          <p className="mt-3 text-white/70">{copy.pricingIntro}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {copy.plans.map((plan) => (
              <div
                key={plan.name}
                className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
              >
                <h3 className="text-lg font-semibold text-[#E9D500]">
                  {plan.name}
                </h3>
                <p className="mt-2 font-bold">{plan.price}</p>
                <p className="mt-2 text-sm text-white/70">{plan.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-white/75">
            {copy.trial}
          </p>
          <Link to="/pricing" className={`${ghostButton} mt-6`}>
            {copy.seePricing}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold">{copy.faqsTitle}</h2>
        <div className="mt-8 space-y-6">
          {copy.faqs.map((item) => (
            <div
              key={item.q}
              className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
            >
              <h3 className="font-semibold text-[#E9D500]">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">{copy.finalTitle}</h2>
            <p className="mt-2 text-white/70">{copy.finalBody}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/demo" className={yellowButton}>
              {copy.bookDemo}
            </Link>
            <Link to="/signup?plan=car-line" className={ghostButton}>
              {t("marketingLanding.startFreeTrial")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
