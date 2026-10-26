/**
 * Blog post loader.
 *
 * Markdown files live in `content/blog/*.md` and are bundled at build time via
 * Vite's `import.meta.glob` so they ship with the Worker — no filesystem access
 * at runtime. Each file has YAML-ish front matter followed by a Markdown body.
 *
 * Front matter we support (simple, not full YAML):
 *   title:    "string"        required
 *   date:     YYYY-MM-DD       required
 *   slug:     lower-kebab      required
 *   excerpt:  "string"         required
 *   author:   "string"
 *   tags:     ["a", "b"]
 *   image:    "url" | ""
 *   seoTitle: "string"        optional document title, when it differs from title
 *
 * We intentionally do NOT pull in `gray-matter` — it depends on Node's
 * `Buffer`, which isn't present on Cloudflare Workers. Front matter and
 * HTML rendering live in `markdown-body.ts`.
 */

import type { FaqItem } from "./markdown-body";
import { prepareMarketingMarkdown, splitFrontMatter } from "./markdown-body";

import type { BlogPostMeta } from "./blog";
export type { BlogPostMeta } from "./blog";
// Re-export the client-safe date formatter so callers that already pull other
// things from this module don't have to add a second import. Routes that only
// need `formatPostDate` from a component body MUST import from `~/lib/blog`.
export { formatPostDate } from "./blog";

export type BlogPost = BlogPostMeta & {
  /** Rendered HTML body (without front matter). */
  html: string;
  /** Approximate reading time in minutes, rounded up. */
  readingTimeMinutes: number;
  /** Document title when it should differ from the visible H1. */
  seoTitle: string;
  faqs: FaqItem[];
  /** Numbered "### N. Name" headings, for ItemList structured data. */
  tools: string[];
};

// Vite statically analyzes this pattern. The path is relative to the project
// root because it starts with `/`.
const RAW_POSTS = import.meta.glob("/content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function readingTime(body: string): number {
  // Words-per-minute for casual reading. 220 is a common approximation.
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 220));
}

function toPost(file: string, source: string): BlogPost {
  const { data, body } = splitFrontMatter(source);

  const required = (key: string): string => {
    const v = data[key];
    if (typeof v !== "string" || !v) {
      throw new Error(
        `Blog post ${file} is missing required front matter field: ${key}`
      );
    }
    return v;
  };

  const meta: BlogPostMeta = {
    title: required("title"),
    date: required("date"),
    slug: required("slug"),
    excerpt: required("excerpt"),
    author: typeof data.author === "string" ? data.author : "PickupRoster Team",
    tags: Array.isArray(data.tags) ? data.tags : [],
    image: typeof data.image === "string" ? data.image : "",
  };

  const prepared = prepareMarketingMarkdown(body);

  return {
    ...meta,
    html: prepared.html,
    readingTimeMinutes: readingTime(prepared.text),
    seoTitle: typeof data.seoTitle === "string" ? data.seoTitle : "",
    faqs: prepared.faqs,
    tools: prepared.tools,
  };
}

// Parse everything once at module load. The Worker bundle is static per
// deploy, so there is nothing to invalidate.
const ALL_POSTS: BlogPost[] = Object.entries(RAW_POSTS)
  .map(([file, source]) => toPost(file, source))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const BY_SLUG = new Map(ALL_POSTS.map((p) => [p.slug, p]));

/** All posts, newest first, metadata only (no HTML body). */
export function listPosts(): BlogPostMeta[] {
  return ALL_POSTS.map((post) => ({
    title: post.title,
    date: post.date,
    slug: post.slug,
    excerpt: post.excerpt,
    author: post.author,
    tags: post.tags,
    image: post.image,
  }));
}

/** Look up a single post by slug, or `null` when it doesn't exist. */
export function getPost(slug: string): BlogPost | null {
  return BY_SLUG.get(slug) ?? null;
}
