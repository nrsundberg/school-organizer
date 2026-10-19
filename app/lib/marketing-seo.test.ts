import test from "node:test";
import assert from "node:assert/strict";
import {
  articleJsonLd,
  buildSitemapXml,
  canonicalRedirectTarget,
  faqPageJsonLd,
  homePageJsonLd,
  itemListJsonLd,
  marketingRobotsTxt,
  publicSiteOrigin,
  SITEMAP_PATH_LASTMOD,
  SITEMAP_STATIC_PATHS,
  softwareApplicationJsonLd,
  tenantRobotsTxt,
} from "./marketing-seo";

test("sitemap lists marketing URLs and lastmod only for dated entries", () => {
  const xml = buildSitemapXml("https://pickuproster.com", [
    { path: "/" },
    { path: "/school-pickup-board" },
    { path: "/blog/diagnose-car-line-wait-times-before-the-first-bell", lastmod: "2026-07-20" },
    { path: "/guides/importing-student-rosters-from-sis", lastmod: "not-a-date" },
  ]);
  assert.match(xml, /<loc>https:\/\/pickuproster.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/pickuproster.com\/school-pickup-board<\/loc>/);
  assert.match(xml, /<lastmod>2026-07-20<\/lastmod>/);
  assert.doesNotMatch(xml, /not-a-date/);
  assert.doesNotMatch(xml, /\/admin/);
  assert.doesNotMatch(xml, /\/signup/);
});

test("marketing robots allows the site, blocks app paths, and names the sitemap", () => {
  const txt = marketingRobotsTxt("https://pickuproster.com/sitemap.xml");
  assert.match(txt, /^User-agent: \*/);
  assert.match(txt, /Allow: \//);
  assert.match(txt, /Disallow: \/login/);
  assert.match(txt, /Disallow: \/signup/);
  assert.match(txt, /Disallow: \/admin/);
  assert.match(txt, /Sitemap: https:\/\/pickuproster.com\/sitemap.xml/);
});

test("tenant robots disallows the whole host and has no sitemap", () => {
  const txt = tenantRobotsTxt();
  assert.equal(txt, "User-agent: *\nDisallow: /\n");
  assert.doesNotMatch(txt, /Sitemap:/);
});

test("www and http on the apex redirect to the https apex", () => {
  assert.equal(
    canonicalRedirectTarget(
      new Request("https://www.pickuproster.com/pricing?cycle=annual"),
      "pickuproster.com",
    ),
    "https://pickuproster.com/pricing?cycle=annual",
  );
  assert.equal(
    canonicalRedirectTarget(
      new Request("http://pickuproster.com/faqs", {
        headers: { "x-forwarded-proto": "http" },
      }),
      "pickuproster.com",
    ),
    "https://pickuproster.com/faqs",
  );
  assert.equal(
    canonicalRedirectTarget(
      new Request("https://pickuproster.com/"),
      "pickuproster.com",
    ),
    null,
  );
  assert.equal(
    canonicalRedirectTarget(
      new Request("https://maple.pickuproster.com/"),
      "pickuproster.com",
    ),
    null,
  );
  assert.equal(
    canonicalRedirectTarget(new Request("http://localhost:3000/"), "pickuproster.com"),
    null,
  );
});

test("public site origin prefers the configured apex", () => {
  assert.equal(
    publicSiteOrigin(new Request("http://localhost:3000/"), "pickuproster.com"),
    "https://pickuproster.com",
  );
  assert.equal(
    publicSiteOrigin(new Request("http://localhost:3000/blog"), ""),
    "http://localhost:3000",
  );
});

test("pricing JSON-LD uses the current Car Line and Campus prices", () => {
  const ld = softwareApplicationJsonLd("https://pickuproster.com");
  const offers = ld.offers.map((offer) => `${offer.name}:${offer.price}`);
  assert.deepEqual(offers, [
    "Car Line monthly:150",
    "Car Line annual:1440",
    "Campus monthly:500",
    "Campus annual:4800",
  ]);
});

test("home JSON-LD merges the FAQ into the organization graph", () => {
  const ld = homePageJsonLd("https://pickuproster.com", [
    { q: "What is a school pickup board?", a: "A live display." },
  ]);
  const types = ld["@graph"].map((node) => node["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite", "FAQPage"]);
  const faq = ld["@graph"][2];
  assert.equal(faq && "mainEntity" in faq ? faq.mainEntity[0]?.name : "", "What is a school pickup board?");
  assert.equal("@context" in (faq ?? {}), false);
});

test("FAQ JSON-LD keeps each question and answer", () => {
  const ld = faqPageJsonLd([{ q: "What is it?", a: "A live pickup board." }]);
  assert.equal(ld.mainEntity[0]?.name, "What is it?");
  assert.equal(ld.mainEntity[0]?.acceptedAnswer.text, "A live pickup board.");
});

test("comparison pages are in the sitemap with a lastmod", () => {
  assert.ok(SITEMAP_STATIC_PATHS.includes("/compare/pikmykid-alternatives"));
  assert.ok(SITEMAP_STATIC_PATHS.includes("/compare/schoolpass-vs-pickuproster"));
  assert.equal(SITEMAP_PATH_LASTMOD["/compare/pikmykid-alternatives"], "2026-10-18");
  assert.equal(SITEMAP_PATH_LASTMOD["/compare/schoolpass-vs-pickuproster"], "2026-10-18");
  const xml = buildSitemapXml("https://pickuproster.com", [
    {
      path: "/compare/pikmykid-alternatives",
      lastmod: SITEMAP_PATH_LASTMOD["/compare/pikmykid-alternatives"],
    },
    { path: "/blog/best-school-dismissal-software", lastmod: "2026-10-18" },
  ]);
  assert.match(xml, /<loc>https:\/\/pickuproster.com\/compare\/pikmykid-alternatives<\/loc>/);
  assert.match(xml, /<loc>https:\/\/pickuproster.com\/blog\/best-school-dismissal-software<\/loc>/);
  assert.match(xml, /<lastmod>2026-10-18<\/lastmod>/);
});

test("article and item list JSON-LD name the page and the tools", () => {
  const article = articleJsonLd({
    headline: "SchoolPass vs PickupRoster",
    description: "Compare cost and setup.",
    url: "https://pickuproster.com/compare/schoolpass-vs-pickuproster",
    dateModified: "2026-10-18",
  });
  assert.equal(article["@type"], "Article");
  assert.equal(article.dateModified, "2026-10-18");
  assert.equal(article.headline, "SchoolPass vs PickupRoster");
  const list = itemListJsonLd(["PickupRoster", "PikMyKid (CENTEGIX)"]);
  assert.equal(list.numberOfItems, 2);
  assert.equal(list.itemListElement[1]?.name, "PikMyKid (CENTEGIX)");
  assert.equal(list.itemListElement[1]?.position, 2);
});
