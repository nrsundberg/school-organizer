import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/blog._index";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { formatPostDate, type BlogPostMeta } from "~/lib/blog";
import { listPosts } from "~/lib/blog.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export function meta({ data }: Route.MetaArgs) {
  const count = data?.posts.length ?? 0;
  const desc =
    count > 0 ? data?.metaDescriptionIndex : data?.metaDescriptionEmpty;
  return [
    { title: data?.metaTitle ?? "Blog — PickupRoster" },
    {
      name: "description",
      content: desc ?? "PickupRoster blog — field notes on dismissal, car lines, and district rollouts.",
    },
    { property: "og:title", content: data?.ogTitle ?? "PickupRoster Blog" },
    {
      property: "og:description",
      content: data?.ogDescription ?? "Field notes on school dismissal, car-line operations, and district rollouts.",
    },
    { property: "og:type", content: "website" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");
  return {
    posts: listPosts(),
    metaTitle: t("blog.metaTitleIndex"),
    metaDescriptionIndex: t("blog.metaDescriptionIndex"),
    metaDescriptionEmpty: t("blog.metaDescriptionEmpty"),
    ogTitle: t("blog.ogTitle"),
    ogDescription: t("blog.ogDescription"),
  };
}

export default function BlogIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { posts } = loaderData;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <header className="border-b border-white/10 pb-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#E9D500]">
            {t("blog.kicker")}
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">
            {t("blog.headline")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/70">
            {t("blog.lede")}
          </p>
        </header>

        {posts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="mt-10 divide-y divide-white/10">
            {posts.map((post) => (
              <li key={post.slug} className="py-8 first:pt-10 last:pb-0">
                <PostCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: BlogPostMeta }) {
  const { t } = useTranslation("common");
  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
        <time dateTime={post.date}>{formatPostDate(post.date)}</time>
        <span aria-hidden>·</span>
        <span>{post.author}</span>
      </div>
      <h2 className="mt-2 text-2xl font-bold leading-snug">
        <Link
          to={`/blog/${post.slug}`}
          className="transition hover:text-[#E9D500]"
        >
          {post.title}
        </Link>
      </h2>
      <p className="mt-3 text-base leading-relaxed text-white/75">
        {post.excerpt}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {post.tags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/70"
          >
            {tag}
          </span>
        ))}
        <Link
          to={`/blog/${post.slug}`}
          className="ml-auto text-sm font-semibold text-[#E9D500] transition hover:text-[#f5e047]"
        >
          {t("blog.read")}
        </Link>
      </div>
    </article>
  );
}

function EmptyState() {
  const { t } = useTranslation("common");
  return (
    <div className="mt-12 rounded-2xl border border-dashed border-white/10 bg-[#151a1a] p-10 text-center">
      <p className="text-lg font-semibold text-white">{t("blog.empty.headline")}</p>
      <p className="mt-2 text-sm text-white/60">
        {t("blog.empty.body")}
      </p>
      <Link
        to="/pricing"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
      >
        {t("blog.empty.cta")}
      </Link>
    </div>
  );
}
