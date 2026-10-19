import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prepareMarketingMarkdown, splitFrontMatter } from "./markdown-body";

const ROOT = path.resolve(import.meta.dirname, "../..");

function load(relativePath: string) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const { data, body } = splitFrontMatter(source);
  return { data, prepared: prepareMarketingMarkdown(body) };
}

function visibleText(html: string): string {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

const HIDDEN_URLS = [
  "https://www.centegix.com/press-release/",
  "https://go.boarddocs.com/",
  "https://www.placa.ai/linecam",
  "https://www.getapp.com/",
  "https://www.trustradius.com/",
];

test("published comparison markdown hides source comments and the JSON-LD sample", () => {
  const pages = [
    load("content/compare/pikmykid-alternatives.md"),
    load("content/compare/schoolpass-vs-pickuproster.md"),
    load("content/blog/2026-10-18-best-school-dismissal-software.md"),
  ];
  for (const { prepared } of pages) {
    assert.equal(prepared.faqs.length > 0, true);
    assert.match(prepared.html, /class="table-scroll"/);
    assert.match(prepared.html, /<table/);
    assert.doesNotMatch(prepared.html, /<!--/);
    assert.doesNotMatch(prepared.html, /application\/ld\+json/);
    assert.doesNotMatch(prepared.html, /Publishing notes/);
    for (const url of HIDDEN_URLS) {
      assert.equal(prepared.html.includes(url), false, url);
    }
    const visible = visibleText(prepared.html);
    for (const faq of prepared.faqs) {
      assert.equal(visible.includes(faq.q), true, faq.q);
    }
  }
});

test("each page keeps its H1, title, description, and FAQ", () => {
  const pikmykid = load("content/compare/pikmykid-alternatives.md");
  assert.equal(
    pikmykid.prepared.h1,
    "PikMyKid Alternatives: How School Dismissal Tools Compare in 2026",
  );
  assert.equal(
    pikmykid.data.title_tag,
    "PikMyKid Alternatives (2026): Dismissal Software Compared",
  );
  assert.match(String(pikmykid.data.meta_description), /CENTEGIX/);
  assert.equal(pikmykid.prepared.faqs.length, 6);
  assert.match(pikmykid.prepared.faqs[2]?.a ?? "", /\$150 a month/);
  assert.equal(pikmykid.prepared.html.includes("<h1"), false);

  const schoolpass = load("content/compare/schoolpass-vs-pickuproster.md");
  assert.equal(
    schoolpass.prepared.h1,
    "SchoolPass vs PickupRoster: Which Dismissal System Fits Your School?",
  );
  assert.equal(
    schoolpass.data.title_tag,
    "SchoolPass vs PickupRoster: Dismissal Software Compared",
  );
  assert.equal(schoolpass.prepared.faqs.length, 6);
  assert.match(schoolpass.prepared.faqs[0]?.q ?? "", /How much does SchoolPass cost/);

  const blog = load("content/blog/2026-10-18-best-school-dismissal-software.md");
  assert.equal(
    blog.prepared.h1,
    "The Best School Dismissal Software in 2026: 13 Tools Compared",
  );
  assert.equal(blog.data.title, blog.prepared.h1);
  assert.equal(
    blog.data.seoTitle,
    "Best School Dismissal Software (2026): 13 Tools Compared",
  );
  assert.match(String(blog.data.excerpt), /13 school dismissal/);
  assert.equal(blog.data.date, "2026-10-18");
  assert.equal(blog.data.slug, "best-school-dismissal-software");
  assert.equal(blog.prepared.faqs.length, 6);
  assert.equal(blog.prepared.tools.length, 13);
  assert.equal(blog.prepared.tools[0], "PickupRoster");
  assert.equal(blog.prepared.tools[12], "Time To Dismiss");
  assert.match(blog.prepared.html, /\$150\/mo or \$1,440\/yr/);
});
