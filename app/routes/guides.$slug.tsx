import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/guides.$slug";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { ProseStyles } from "~/components/ProseStyles";
import {
  formatCategory,
  formatDifficulty,
  formatGuideDate,
} from "~/lib/guides";
import { getGuide } from "~/lib/guides.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export function meta({ data }: Route.MetaArgs) {
  if (!data?.guide) {
    return [
      { title: data?.metaNotFound ?? "Guide not found — PickupRoster" },
      { name: "robots", content: "noindex" },
    ];
  }
  const { guide, canonical, metaTitle } = data;
  const description = guide.preview || `${guide.title} — PickupRoster guide.`;
  return [
    { title: metaTitle ?? `${guide.title} — PickupRoster Guides` },
    { name: "description", content: description },
    { property: "og:title", content: guide.title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    { property: "article:published_time", content: guide.date },
    ...(canonical ? [{ rel: "canonical", href: canonical } as const] : []),
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");

  const guide = getGuide(params.slug);
  if (!guide) {
    throw new Response("Guide not found", { status: 404 });
  }
  // Canonical points at the apex marketing host so subdomains don't dilute
  // search indexing of shared guide content.
  const url = new URL(request.url);
  const canonical = `${url.protocol}//pickuproster.com/guides/${guide.slug}`;
  return {
    guide,
    canonical,
    metaTitle: t("guides.post.metaTitle", { title: guide.title }),
    metaNotFound: t("guides.post.metaNotFound"),
  };
}

export default function GuidePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { guide } = loaderData;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <ProseStyles />

      <article className="mx-auto max-w-3xl px-4 py-14">
        <div>
          <Link
            to="/guides"
            className="inline-flex items-center gap-1.5 text-sm text-white/60 transition hover:text-white"
          >
            <span aria-hidden>←</span> {t("guides.allGuides")}
          </Link>
        </div>

        <header className="mt-8 border-b border-white/10 pb-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
            <span className="rounded-full border border-[#E9D500]/40 bg-[#E9D500]/10 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-[#E9D500]">
              {formatCategory(guide.category)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium uppercase tracking-wide text-white/70">
              {formatDifficulty(guide.difficulty)}
            </span>
            <span>{guide.estimatedTime}</span>
          </div>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">
            {guide.title}
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
            <time dateTime={guide.date}>{formatGuideDate(guide.date)}</time>
            <span aria-hidden>·</span>
            <span>{t("guides.post.minRead", { count: guide.readingTimeMinutes })}</span>
          </div>
        </header>

        <div
          className="prose-pr mt-10"
          // eslint-disable-next-line react/no-danger -- content is author-controlled and bundled at build time
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />

        <TrialCta />
      </article>
    </div>
  );
}

function TrialCta() {
  const { t } = useTranslation("common");
  return (
    <aside className="mt-14 rounded-2xl border border-[#E9D500]/30 bg-[#E9D500]/5 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#E9D500]">
        {t("trialCta.kicker")}
      </p>
      <h2 className="mt-2 text-2xl font-bold leading-snug">
        {t("trialCta.headline")}
      </h2>
      <p className="mt-3 text-base text-white/75">
        {t("trialCta.body")}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
        >
          {t("trialCta.seePricing")}
        </Link>
        <Link
          to="/signup"
          className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5"
        >
          {t("trialCta.startFreeTrial")}
        </Link>
      </div>
    </aside>
  );
}

/**
 * Scoped prose styles for the server-rendered markdown body. Mirrors the
 * blog post styles exactly so guides and posts read identically.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation("common");
  const isNotFound =
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status: number }).status === 404;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#E9D500]">
          {isNotFound ? t("errors.notFound") : t("errors.somethingBroke")}
        </p>
        <h1 className="mt-3 text-3xl font-extrabold">
          {isNotFound ? t("guides.errors.notFoundTitle") : t("guides.errors.errorTitle")}
        </h1>
        <p className="mt-3 text-white/70">
          {isNotFound
            ? t("guides.errors.notFoundBody")
            : t("guides.errors.errorBody")}
        </p>
        <div className="mt-8">
          <Link
            to="/guides"
            className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
          >
            {t("guides.errors.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
