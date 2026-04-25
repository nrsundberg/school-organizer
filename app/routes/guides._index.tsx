import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/guides._index";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  formatCategory,
  formatDifficulty,
  formatGuideDate,
  type GuideMeta,
} from "~/lib/guides";
import { listGuidesByCategory } from "~/lib/guides.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export function meta({ data }: Route.MetaArgs) {
  const count = data?.totalCount ?? 0;
  return [
    { title: data?.metaTitle ?? "Guides — PickupRoster" },
    {
      name: "description",
      content:
        count > 0
          ? data?.metaDescriptionIndex ?? "How-to guides for setting up and running PickupRoster — roster imports, drill templates, branding, billing, and dismissal-day operations."
          : data?.metaDescriptionEmpty ?? "PickupRoster guides — how-to articles for school administrators.",
    },
    { property: "og:title", content: data?.ogTitle ?? "PickupRoster Guides" },
    {
      property: "og:description",
      content: data?.ogDescription ?? "How-to guides for setting up and running PickupRoster across your school or district.",
    },
    { property: "og:type", content: "website" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const groups = listGuidesByCategory();
  const totalCount = groups.reduce((n, g) => n + g.guides.length, 0);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");

  return {
    groups,
    totalCount,
    metaTitle: t("guides.metaTitleIndex"),
    metaDescriptionIndex: t("guides.metaDescriptionIndex"),
    metaDescriptionEmpty: t("guides.metaDescriptionEmpty"),
    ogTitle: t("guides.ogTitle"),
    ogDescription: t("guides.ogDescription"),
  };
}

export default function GuidesIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { groups, totalCount } = loaderData;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <header className="border-b border-white/10 pb-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#E9D500]">
            {t("guides.kicker")}
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">
            {t("guides.headline")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/70">
            {t("guides.lede")}
          </p>
        </header>

        {totalCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-10 space-y-12">
            {groups.map((group) => (
              <section key={group.category}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  {formatCategory(group.category)}
                </h2>
                <ul className="mt-4 divide-y divide-white/10">
                  {group.guides.map((guide) => (
                    <li key={guide.slug} className="py-6 first:pt-4 last:pb-0">
                      <GuideCard guide={guide} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GuideCard({
  guide,
}: {
  guide: GuideMeta & { preview: string; readingTimeMinutes: number };
}) {
  const { t } = useTranslation("common");
  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium uppercase tracking-wide text-white/70">
          {formatDifficulty(guide.difficulty)}
        </span>
        <span>{guide.estimatedTime}</span>
        <span aria-hidden>·</span>
        <time dateTime={guide.date}>{formatGuideDate(guide.date)}</time>
      </div>
      <h3 className="mt-2 text-2xl font-bold leading-snug">
        <Link
          to={`/guides/${guide.slug}`}
          className="transition hover:text-[#E9D500]"
        >
          {guide.title}
        </Link>
      </h3>
      {guide.preview && (
        <p className="mt-3 text-base leading-relaxed text-white/75">
          {guide.preview}
        </p>
      )}
      <div className="mt-4">
        <Link
          to={`/guides/${guide.slug}`}
          className="text-sm font-semibold text-[#E9D500] transition hover:text-[#f5e047]"
        >
          {t("guides.readGuide")}
        </Link>
      </div>
    </article>
  );
}

function EmptyState() {
  const { t } = useTranslation("common");
  return (
    <div className="mt-12 rounded-2xl border border-dashed border-white/10 bg-[#151a1a] p-10 text-center">
      <p className="text-lg font-semibold text-white">{t("guides.empty.headline")}</p>
      <p className="mt-2 text-sm text-white/60">
        {t("guides.empty.body")}
      </p>
      <Link
        to="/pricing"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
      >
        {t("guides.empty.cta")}
      </Link>
    </div>
  );
}
