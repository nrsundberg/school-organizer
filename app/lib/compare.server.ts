/**
 * Comparison pages under /compare. Markdown lives in content/compare and is
 * bundled with the Worker. Editorial HTML comments stay in the source files
 * and are stripped before render.
 */

import { prepareMarketingMarkdown, splitFrontMatter, type FaqItem } from "./markdown-body";

export type ComparePage = {
  slug: string;
  path: string;
  titleTag: string;
  metaDescription: string;
  h1: string;
  dateModified: string;
  html: string;
  faqs: FaqItem[];
};

const RAW_PAGES = import.meta.glob("/content/compare/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toPage(file: string, source: string): ComparePage {
  const { data, body } = splitFrontMatter(source);
  const prepared = prepareMarketingMarkdown(body);
  const slug = file.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const url = typeof data.url === "string" ? data.url : "";
  const path = url.startsWith("/") ? url : `/compare/${slug}`;
  const titleTag = typeof data.title_tag === "string" ? data.title_tag : "";
  const metaDescription = typeof data.meta_description === "string" ? data.meta_description : "";
  if (!slug || !titleTag || !metaDescription || !prepared.h1) {
    throw new Error(`Compare page ${file} is missing a title, description, or H1`);
  }
  const verified = typeof data.last_verified === "string" ? data.last_verified : "";
  return {
    slug,
    path,
    titleTag,
    metaDescription,
    h1: prepared.h1,
    dateModified: DATE.test(verified) ? verified : "2026-10-18",
    html: prepared.html,
    faqs: prepared.faqs,
  };
}

const ALL_PAGES: ComparePage[] = Object.entries(RAW_PAGES)
  .map(([file, source]) => toPage(file, source))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const BY_SLUG = new Map(ALL_PAGES.map((page) => [page.slug, page]));

export function listComparePages(): ComparePage[] {
  return ALL_PAGES;
}

export function getComparePage(slug: string): ComparePage | null {
  return BY_SLUG.get(slug) ?? null;
}
