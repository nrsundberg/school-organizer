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
 *
 * We intentionally do NOT pull in `gray-matter` — it depends on Node's
 * `Buffer`, which isn't present on Cloudflare Workers. The parser below is
 * ~30 lines and handles everything our posts use.
 */

import { marked } from "marked";

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
};

// Vite statically analyzes this pattern. The path is relative to the project
// root because it starts with `/`.
const RAW_POSTS = import.meta.glob("/content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Configure marked once. GitHub-flavored defaults + smart list merging.
marked.setOptions({
  gfm: true,
  breaks: false,
});

/** Strip a single pair of surrounding double or single quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse a YAML-flow-style array like `["a", "b", c]`. */
function parseInlineArray(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

type ParsedFrontMatter = {
  data: Record<string, string | string[]>;
  body: string;
};

/**
 * Split a markdown file into its front matter and body.
 *
 * We only support the `---\n…\n---\n` opening-fence shape, which is what our
 * writer produces. A file without front matter returns `{ data: {}, body }`.
 */
function parseFrontMatter(source: string): ParsedFrontMatter {
  if (!source.startsWith("---")) {
    return { data: {}, body: source };
  }
  const end = source.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: source };
  }
  const fmBlock = source.slice(3, end).replace(/^\r?\n/, "");
  // Body starts after the closing `---\n`.
  const afterFence = source.indexOf("\n", end + 1);
  const body = afterFence === -1 ? "" : source.slice(afterFence + 1);

  const data: Record<string, string | string[]> = {};
  for (const rawLine of fmBlock.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonAt = line.indexOf(":");
    if (colonAt === -1) continue;
    const key = line.slice(0, colonAt).trim();
    const value = line.slice(colonAt + 1).trim();
    if (!key) continue;
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = parseInlineArray(value);
    } else {
      data[key] = unquote(value);
    }
  }

  return { data, body };
}

function readingTime(body: string): number {
  // Words-per-minute for casual reading. 220 is a common approximation.
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 220));
}

function toPost(file: string, source: string): BlogPost {
  const { data, body } = parseFrontMatter(source);

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
    file,
  };

  // marked.parse returns string synchronously when `async: false` (default).
  const html = marked.parse(body) as string;

  return {
    ...meta,
    html,
    readingTimeMinutes: readingTime(body),
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
  return ALL_POSTS.map(({ html: _html, ...meta }) => meta);
}

/** Look up a single post by slug, or `null` when it doesn't exist. */
export function getPost(slug: string): BlogPost | null {
  return BY_SLUG.get(slug) ?? null;
}
