import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/guides.$slug";
import { MarketingNav } from "~/components/marketing/MarketingNav";
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
function ProseStyles() {
  const css = `
    .prose-pr { color: rgb(255 255 255 / 0.85); font-size: 1.0625rem; line-height: 1.75; }
    .prose-pr > * + * { margin-top: 1.25em; }
    .prose-pr h2 { color: #fff; font-size: 1.6rem; font-weight: 700; line-height: 1.25; margin-top: 2.25em; margin-bottom: 0.5em; letter-spacing: -0.01em; }
    .prose-pr h3 { color: #fff; font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin-top: 1.75em; margin-bottom: 0.5em; }
    .prose-pr p { margin: 1em 0; }
    .prose-pr a { color: #E9D500; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .prose-pr a:hover { color: #f5e047; }
    .prose-pr strong { color: #fff; font-weight: 600; }
    .prose-pr em { color: rgb(255 255 255 / 0.9); }
    .prose-pr ul, .prose-pr ol { padding-left: 1.5rem; margin: 1em 0; }
    .prose-pr ul { list-style: disc; }
    .prose-pr ol { list-style: decimal; }
    .prose-pr li { margin: 0.4em 0; }
    .prose-pr li::marker { color: rgb(233 213 0 / 0.6); }
    .prose-pr blockquote {
      margin: 1.75em 0;
      padding: 0.25em 0 0.25em 1.25em;
      border-left: 3px solid #E9D500;
      color: #fff;
      font-size: 1.2rem;
      font-style: italic;
      line-height: 1.5;
    }
    .prose-pr blockquote p { margin: 0; }
    .prose-pr code {
      background: rgb(255 255 255 / 0.08);
      border: 1px solid rgb(255 255 255 / 0.08);
      padding: 0.1em 0.35em;
      border-radius: 0.35rem;
      font-size: 0.92em;
      color: #fff;
    }
    .prose-pr pre {
      background: #0a0d0d;
      border: 1px solid rgb(255 255 255 / 0.08);
      padding: 1rem 1.25rem;
      border-radius: 0.75rem;
      overflow-x: auto;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .prose-pr pre code { background: transparent; border: 0; padding: 0; }
    .prose-pr hr { border: 0; border-top: 1px solid rgb(255 255 255 / 0.1); margin: 2.25em 0; }
    .prose-pr img { border-radius: 0.75rem; max-width: 100%; height: auto; }
    .prose-pr table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.95rem; }
    .prose-pr th, .prose-pr td {
      border-bottom: 1px solid rgb(255 255 255 / 0.1);
      padding: 0.6em 0.75em;
      text-align: left;
    }
    .prose-pr th { color: #fff; font-weight: 600; }
  `;
  // eslint-disable-next-line react/no-danger
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

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
