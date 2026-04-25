/**
 * Guide loader.
 *
 * Markdown files live in `content/guides/*.md` and are bundled at build time
 * via Vite's `import.meta.glob` so they ship with the Worker — no filesystem
 * access at runtime. Each file has YAML-ish front matter followed by a
 * Markdown body.
 *
 * Front matter we support (simple, not full YAML):
 *   title:           "string"        required
 *   date:            YYYY-MM-DD       required
 *   slug:            lower-kebab      required
 *   category:        "string"         required (e.g. "setup", "operations")
 *   estimated_time:  "8 minutes"      required
 *   difficulty:      beginner|intermediate|advanced  required
 *
 * Mirrors `blog.server.ts` deliberately — the parser, reading-time, and
 * marked configuration are intentionally identical so the two surfaces
 * behave the same way for authors. We keep them as separate modules instead
 * of a generic loader because the front matter shapes diverge enough that
 * the type wins are worth the duplication.
 */

import { marked } from "marked";

import type { GuideMeta, GuideDifficulty } from "./guides";
export type { GuideMeta, GuideDifficulty } from "./guides";
// Re-export client-safe formatters for callers that already pull other
// things from this module. Component bodies should still import from
// `~/lib/guides` directly.
export { formatGuideDate, formatCategory, formatDifficulty } from "./guides";

export type Guide = GuideMeta & {
  /** Rendered HTML body (without front matter). */
  html: string;
  /** Approximate reading time in minutes, rounded up. */
  readingTimeMinutes: number;
  /**
   * Plain-text first paragraph of the body, trimmed to ~220 chars. Used as
   * a card summary on the index when the author hasn't written one.
   */
  preview: string;
};

// Vite statically analyzes this pattern. The path is relative to the project
// root because it starts with `/`.
const RAW_GUIDES = import.meta.glob("/content/guides/*.md", {
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
 * Split a markdown file into its front matter and body. We only support the
 * `---\n…\n---\n` opening-fence shape, which is what our writer produces.
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
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 220));
}

/**
 * Take the first paragraph of the body and turn it into a plain-text
 * preview. Strips heading lines, list markers, code fences, and inline
 * markdown emphasis. Trims to ~220 chars at a word boundary.
 */
function buildPreview(body: string): string {
  // Walk lines, skipping headings, blockquotes, code fences, and blank lines
  // until we hit a paragraph. Then accumulate until the next blank line.
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let started = false;
  const acc: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!started) {
      if (!line) continue;
      if (line.startsWith("#")) continue;
      if (line.startsWith(">")) continue;
      if (line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s/.test(line)) {
        continue;
      }
      started = true;
      acc.push(line);
      continue;
    }
    if (!line) break;
    acc.push(line);
  }
  const joined = acc.join(" ");
  // Strip the most common inline markdown so the preview reads as plain text.
  const stripped = joined
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  if (stripped.length <= 220) return stripped;
  const cut = stripped.slice(0, 220);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

const ALLOWED_DIFFICULTY: ReadonlySet<GuideDifficulty> = new Set([
  "beginner",
  "intermediate",
  "advanced",
]);

function toGuide(file: string, source: string): Guide {
  const { data, body } = parseFrontMatter(source);

  const required = (key: string): string => {
    const v = data[key];
    if (typeof v !== "string" || !v) {
      throw new Error(
        `Guide ${file} is missing required front matter field: ${key}`
      );
    }
    return v;
  };

  // `estimated_time` (snake) is what authors write; we expose it as
  // `estimatedTime` (camel) on the typed object.
  const rawDifficulty = required("difficulty").toLowerCase();
  const difficulty: GuideDifficulty = ALLOWED_DIFFICULTY.has(
    rawDifficulty as GuideDifficulty
  )
    ? (rawDifficulty as GuideDifficulty)
    : "beginner";

  const meta: GuideMeta = {
    title: required("title"),
    date: required("date"),
    slug: required("slug"),
    category: required("category"),
    estimatedTime: required("estimated_time"),
    difficulty,
    file,
  };

  const html = marked.parse(body) as string;

  return {
    ...meta,
    html,
    readingTimeMinutes: readingTime(body),
    preview: buildPreview(body),
  };
}

// Parse everything once at module load. The Worker bundle is static per
// deploy, so there is nothing to invalidate.
const ALL_GUIDES: Guide[] = Object.entries(RAW_GUIDES)
  .map(([file, source]) => toGuide(file, source))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const BY_SLUG = new Map(ALL_GUIDES.map((g) => [g.slug, g]));

/** All guides, newest first, metadata + preview only (no HTML body). */
export function listGuides(): (GuideMeta & { preview: string; readingTimeMinutes: number })[] {
  return ALL_GUIDES.map(({ html: _html, ...rest }) => rest);
}

/**
 * All guides grouped by category, in the order categories first appear in
 * `listGuides()` (i.e. by the newest guide in each category).
 */
export function listGuidesByCategory(): {
  category: string;
  guides: (GuideMeta & { preview: string; readingTimeMinutes: number })[];
}[] {
  const groups = new Map<string, (GuideMeta & { preview: string; readingTimeMinutes: number })[]>();
  for (const g of listGuides()) {
    const existing = groups.get(g.category);
    if (existing) {
      existing.push(g);
    } else {
      groups.set(g.category, [g]);
    }
  }
  return Array.from(groups.entries()).map(([category, guides]) => ({
    category,
    guides,
  }));
}

/** Look up a single guide by slug, or `null` when it doesn't exist. */
export function getGuide(slug: string): Guide | null {
  return BY_SLUG.get(slug) ?? null;
}
