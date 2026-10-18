import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/compare.$slug";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { ProseStyles } from "~/components/ProseStyles";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import { getComparePage } from "~/lib/compare.server";
import {
  articleJsonLd,
  canonicalUrl,
  faqPageJsonLd,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";

export const handle = { i18n: ["common"] };

export function meta({ data }: Route.MetaArgs) {
  if (!data?.page) {
    return [
      { title: data?.metaNotFound ?? "Page not found — PickupRoster" },
      { name: "robots", content: "noindex" },
    ];
  }
  const { page, canonical, origin } = data;
  return marketingPageMeta({
    title: page.titleTag,
    description: page.metaDescription,
    canonical,
    origin,
    image: true,
    type: "article",
    jsonLd: [
      articleJsonLd({
        headline: page.h1,
        description: page.metaDescription,
        url: canonical,
        dateModified: page.dateModified,
      }),
      faqPageJsonLd(page.faqs),
    ],
  });
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const page = getComparePage(params.slug);
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}${page.path}`);
  }
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  return {
    page,
    origin,
    canonical: canonicalUrl(origin, page.path),
    metaNotFound: "Page not found — PickupRoster",
  };
}

export default function ComparePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { page } = loaderData;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <ProseStyles />
      <article className="mx-auto max-w-6xl px-4 py-14">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#E9D500]">
          {t("compare.kicker")}
        </p>
        <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">
          {page.h1}
        </h1>
        <div
          className="prose-pr mt-8"
          // eslint-disable-next-line react/no-danger -- author-controlled markdown bundled at build time
          dangerouslySetInnerHTML={{ __html: page.html }}
        />
      </article>
    </div>
  );
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
          {isNotFound ? t("compare.notFoundTitle") : t("compare.errorTitle")}
        </h1>
        <p className="mt-3 text-white/70">
          {isNotFound ? t("compare.notFoundBody") : t("compare.errorBody")}
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
          >
            {t("compare.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
