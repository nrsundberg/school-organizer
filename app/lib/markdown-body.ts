/**
 * Shared markdown prep for marketing articles.
 *
 * Source files may carry editorial HTML comments (source URLs) and a
 * FAQPage JSON-LD sample at the bottom. Neither belongs in the rendered
 * page. The JSON-LD is parsed out and returned so the route can emit it
 * as structured data.
 */

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export type FaqItem = { q: string; a: string };

export type PreparedMarkdown = {
  /** Leading "# " heading, when the body starts with one. */
  h1: string | null;
  /** Body after comments, the JSON-LD sample, and the leading H1 are removed. */
  text: string;
  html: string;
  faqs: FaqItem[];
  /** Headings shaped like "### 12. Tool name", in order. */
  tools: string[];
};

type ParsedFrontMatter = {
  data: Record<string, string | string[]>;
  body: string;
};

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

function parseInlineArray(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

/** Split a `---\n…\n---\n` opening fence. A file without one returns the source. */
export function splitFrontMatter(source: string): ParsedFrontMatter {
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

export function extractFaqItems(source: string): FaqItem[] {
  const match = source.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match?.[1]) return [];
  try {
    const data = JSON.parse(match[1]) as {
      "@type"?: string;
      mainEntity?: { name?: string; acceptedAnswer?: { text?: string } }[];
    };
    if (data["@type"] !== "FAQPage" || !Array.isArray(data.mainEntity)) return [];
    return data.mainEntity
      .map((item) => ({
        q: typeof item.name === "string" ? item.name.trim() : "",
        a: typeof item.acceptedAnswer?.text === "string" ? item.acceptedAnswer.text.trim() : "",
      }))
      .filter((item) => item.q && item.a);
  } catch {
    return [];
  }
}

function stripJsonLdSample(source: string): string {
  const withoutNote = source.replace(/<!--\s*FAQPage JSON-LD:[\s\S]*$/, "");
  return withoutNote.replace(
    /```html\s*<script type="application\/ld\+json">[\s\S]*?<\/script>\s*```/g,
    "",
  );
}

function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

function stripLeadingH1(source: string): { h1: string | null; rest: string } {
  const trimmed = source.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  const match = trimmed.match(/^#\s+([^\n]+)\n?/);
  if (!match) return { h1: null, rest: trimmed };
  return {
    h1: match[1].trim(),
    rest: trimmed.slice(match[0].length).replace(/^\s+/, ""),
  };
}

function extractNumberedTools(markdown: string): string[] {
  const tools: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^###\s+\d+\.\s+(.+?)\s*$/);
    if (match?.[1]) tools.push(match[1].trim());
  }
  return tools;
}

/** Horizontal scroll for wide comparison tables, including on a phone. */
export function wrapMarkdownTables(html: string): string {
  return html.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (table) =>
      `<div class="table-scroll" tabindex="0" role="region" aria-label="Comparison table">${table}</div>`,
  );
}

export function prepareMarketingMarkdown(body: string): PreparedMarkdown {
  const faqs = extractFaqItems(body);
  const withoutSample = stripJsonLdSample(body);
  const withoutComments = stripHtmlComments(withoutSample);
  const { h1, rest } = stripLeadingH1(withoutComments);
  const html = wrapMarkdownTables(marked.parse(rest) as string);
  return {
    h1,
    text: rest,
    html,
    faqs,
    tools: extractNumberedTools(rest),
  };
}
