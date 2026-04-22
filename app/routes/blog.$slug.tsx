import { Link } from "react-router";
import type { Route } from "./+types/blog.$slug";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { formatPostDate } from "~/lib/blog";
import { getPost } from "~/lib/blog.server";

export function meta({ data }: Route.MetaArgs) {
  if (!data?.post) {
    return [
      { title: "Post not found — PickupRoster" },
      { name: "robots", content: "noindex" },
    ];
  }
  const { post, canonical } = data;
  return [
    { title: `${post.title} — PickupRoster Blog` },
    { name: "description", content: post.excerpt },
    { property: "og:title", content: post.title },
    { property: "og:description", content: post.excerpt },
    { property: "og:type", content: "article" },
    { property: "article:published_time", content: post.date },
    { property: "article:author", content: post.author },
    ...(canonical ? [{ rel: "canonical", href: canonical } as const] : []),
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const post = getPost(params.slug);
  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }
  // Canonical points at the apex marketing host so subdomains don't dilute
  // search indexing of shared blog content.
  const url = new URL(request.url);
  const canonical = `${url.protocol}//pickuproster.com/blog/${post.slug}`;
  return { post, canonical };
}

export default function BlogPostPage({ loaderData }: Route.ComponentProps) {
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
            <span aria-hidden>←</span> Back to blog
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
            <span>{post.readingTimeMinutes} min read</span>
          </div>
        </header>

        <div
          className="prose-pr mt-10"
          // eslint-disable-next-line react/no-danger -- content is author-controlled and bundled at build time
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        <TrialCta />
      </article>
    </div>
  );
}

function TrialCta() {
  return (
    <aside className="mt-14 rounded-2xl border border-[#E9D500]/30 bg-[#E9D500]/5 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#E9D500]">
        Try PickupRoster
      </p>
      <h2 className="mt-2 text-2xl font-bold leading-snug">
        Get structured dismissal up and running in a week.
      </h2>
      <p className="mt-3 text-base text-white/75">
        30-day free trial. No credit card required. Built for schools running
        dismissal for 300 to 3,000 students.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
        >
          See pricing
        </Link>
        <Link
          to="/signup"
          className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5"
        >
          Start free trial
        </Link>
      </div>
    </aside>
  );
}

/**
 * Scoped prose styles for the server-rendered markdown body. We aren't using
 * the Tailwind Typography plugin (not installed), so this is a focused set of
 * rules that match the marketing dark theme. Confined to `.prose-pr` so it
 * can't leak into the rest of the app.
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
          {isNotFound ? "404" : "Something broke"}
        </p>
        <h1 className="mt-3 text-3xl font-extrabold">
          {isNotFound ? "We can't find that post." : "We hit a snag loading this post."}
        </h1>
        <p className="mt-3 text-white/70">
          {isNotFound
            ? "It may have been renamed or unpublished. The full archive is one click away."
            : "Try refreshing; if the problem sticks, let us know."}
        </p>
        <div className="mt-8">
          <Link
            to="/blog"
            className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]"
          >
            Back to blog
          </Link>
        </div>
      </div>
    </div>
  );
}
