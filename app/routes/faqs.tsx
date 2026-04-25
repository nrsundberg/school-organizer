import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/faqs";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { SUPPORTED_LANGUAGES } from "~/lib/i18n-config";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "FAQs — Pickup Roster" },
    { name: "description", content: data?.metaDescription ?? "Common questions about car line boards, trials, and security." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");
  return {
    metaTitle: t("faqs.metaTitle"),
    metaDescription: t("faqs.metaDescription"),
  };
}

export default function Faqs() {
  const { t } = useTranslation("common");
  const names = SUPPORTED_LANGUAGES.map((l) => l.nativeName).join(", ");

  const items = [
    { q: t("faqs.items.where.q"), a: t("faqs.items.where.a") },
    { q: t("faqs.items.trial.q"), a: t("faqs.items.trial.a") },
    { q: t("faqs.items.viewer.q"), a: t("faqs.items.viewer.a") },
    { q: t("faqs.items.domain.q"), a: t("faqs.items.domain.a") },
    {
      q: t("marketing.faqLanguageQuestion"),
      a: `${t("marketing.languageList", { names })} ${t("marketing.faqLanguageAnswerSuffix")}`,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">{t("faqs.heading")}</h1>
        <p className="mt-3 text-lg text-white/70">{t("faqs.lede")}</p>

        <div className="mt-10 space-y-8">
          {items.map((item) => (
            <div key={item.q} className="rounded-2xl border border-white/10 bg-[#151a1a] p-5">
              <h2 className="text-lg font-semibold text-[#E9D500]">{item.q}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                {item.a}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-white/50">
          {t("faqs.readyToTry")}{" "}
          <Link to="/signup" className="text-[#E9D500] underline hover:text-[#f5e047]">
            {t("faqs.createAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
