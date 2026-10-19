import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/blog.$slug";
import { ContentCta } from "~/components/marketing/ContentCta";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { ProseStyles } from "~/components/ProseStyles";
import { formatPostDate } from "~/lib/blog";
import { getPost } from "~/lib/blog.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import {
  articleJsonLd,
  canonicalUrl,
  faqPageJsonLd,
  itemListJsonLd,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";

export function meta({ data }: Route.MetaArgs) {
  if (!data?.post) {
    return [
      { title: data?.metaNotFound ?? "Post not found — PickupRoster" },
      { name: "robots", content: "noindex" },
    ];
  }
  const { post, canonical, metaTitle, origin } = data;
  if (post.seoTitle && canonical && origin) {
    const jsonLd = [
      articleJsonLd({
        headline: post.title,
        description: post.excerpt,
        url: canonical,
        dateModified: post.date,
        datePublished: post.date,
      }),
      ...(post.faqs.length > 0 ? [faqPageJsonLd(post.faqs)] : []),
      ...(post.tools.length > 0 ? [itemListJsonLd(post.tools)] : []),
    ];
    return [
      ...marketingPageMeta({
        title: post.seoTitle,
        description: post.excerpt,
        canonical,
        origin,
        image: true,
        type: "article",
        jsonLd,
      }),
      { property: "article:published_time", content: post.date },
      { property: "article:modified_time", content: post.date },
      { property: "article:author", content: post.author },
    ];
  }
  return [
    { title: metaTitle ?? `${post.title} — PickupRoster Blog` },
    { name: "description", content: post.excerpt },
    { property: "og:title", content: post.title },
    { property: "og:description", content: post.excerpt },
    { property: "og:type", content: "article" },
    { property: "article:published_time", content: post.date },
    { property: "article:author", content: post.author },
    ...(canonical
      ? [{ tagName: "link" as const, rel: "canonical", href: canonical }]
      : [])
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");

  const post = getPost(params.slug);
  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  const canonical = canonicalUrl(origin, `/blog/${post.slug}`);
  return {
    post,
    origin,
    canonical,
    metaTitle: t("blog.post.metaTitle", { title: post.title }),
    metaNotFound: t("blog.post.metaNotFound"),
  };
}

export default function BlogPostPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { post } = loaderData;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <ProseStyles />

      <article className="mx-auto max-w-3xl px-4 py-14">
        <div>
          <Link
            to="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-white/60 transition hover:text-white"
          >
            <span aria-hidden>←</span> {t("blog.post.back")}
          </Link>
        </div>

        <header className="mt-8 border-b border-white/10 pb-8">
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/60"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg text-white/70">{post.excerpt}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
            <span className="font-medium text-white/70">{post.author}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{t("blog.post.minRead", { count: post.readingTimeMinutes })}</span>
          </div>
        </header>

        <div
          className="prose-pr mt-10"
          // eslint-disable-next-line react/no-danger -- content is author-controlled and bundled at build time
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        <ContentCta />
      </article>
    </div>
  );
}

/**
 * Scoped prose styles for the server-rendered markdown body. We aren't using
 * the Tailwind Typography plugin (not installed), so this is a focused set of
 * rules that match the marketing dark theme. Confined to `.prose-pr` so it
 * can't leak into the rest of the app.
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
          {isNotFound ? t("blog.errors.notFoundTitle") : t("blog.errors.errorTitle")}
        </h1>
        <p className="mt-3 text-white/70">
          {isNotFound
            ? t("blog.errors.notFoundBody")
            : t("blog.errors.errorBody")}
        </p>
        <div className="mt-8">
          <Link
            to="/blog"
            className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
          >
            {t("blog.errors.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
