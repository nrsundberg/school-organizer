import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentSourceRedirect,
  indexingAction,
  isAppHostname,
  isAppMarketingPath,
  LEGACY_PATH_REDIRECTS,
  legacySlugRedirect,
  marketingNoindexHeader,
  sitemapPathIsIndexable,
} from "./indexing";
import { SITEMAP_STATIC_PATHS } from "./marketing-seo";

const ROOT = join(import.meta.dirname, "../..");

function frontMatterSlug(source: string): string | null {
  const match = source.match(/^slug:\s*("?)([a-z0-9-]+)\1\s*$/m);
  return match?.[2] ?? null;
}

function loadSection(section: "blog" | "guides"): { slugs: Set<string>; files: string[] } {
  const dir = join(ROOT, "content", section);
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  const slugs = new Set<string>();
  for (const file of files) {
    const slug = frontMatterSlug(readFileSync(join(dir, file), "utf8"));
    assert.ok(slug, `${section}/${file} is missing a slug`);
    slugs.add(slug);
  }
  return { slugs, files };
}

const blog = loadSection("blog");
const guides = loadSection("guides");
const slugs = { blog: blog.slugs, guides: guides.slugs };

test("every published markdown file redirects to its public slug", () => {
  for (const section of ["blog", "guides"] as const) {
    const loaded = section === "blog" ? blog : guides;
    for (const file of loaded.files) {
      const decision = contentSourceRedirect(`/content/${section}/${file}`, slugs);
      const slug = frontMatterSlug(readFileSync(join(ROOT, "content", section, file), "utf8"));
      assert.deepEqual(decision, { status: 301, path: `/${section}/${slug}` });
    }
  }
});

test("a markdown source path with no post is gone", () => {
  assert.deepEqual(
    contentSourceRedirect(
      "/content/blog/2026-01-01-this-post-was-never-published.md",
      slugs,
    ),
    { status: 410 },
  );
  assert.deepEqual(
    contentSourceRedirect("/content/guides/notes.md", slugs),
    { status: 410 },
  );
  assert.equal(contentSourceRedirect("/blog/reducing-car-line-wait-times-with-structured-lanes", slugs), null);
});

test("manual-numbered source files keep the public slug", () => {
  const decision = contentSourceRedirect(
    "/content/blog/2026-04-23-manual-1438-parent-communication-confirming-pickup-changes-without-chaos.md",
    slugs,
  );
  assert.deepEqual(decision, {
    status: 301,
    path: "/blog/parent-communication-confirming-pickup-changes-without-chaos",
  });
});

test("retired slugs point at the current page", () => {
  assert.equal(
    legacySlugRedirect("/guides/handling-early-dismissal-requests"),
    "/blog/staff-workflows-who-approves-early-dismissal",
  );
  assert.equal(
    legacySlugRedirect("/guides/privacy-and-ferpa-in-pickup-logistics"),
    "/blog/privacy-and-ferpa-in-pickup-logistics",
  );
  assert.equal(
    legacySlugRedirect("/blog/structured-lanes-that-actually-cut-car-line-wait-times"),
    "/blog/reducing-car-line-wait-times-with-structured-lanes",
  );
  for (const target of Object.values(LEGACY_PATH_REDIRECTS)) {
    const [section, slug] = target.slice(1).split("/");
    const known = section === "blog" ? blog.slugs : guides.slugs;
    assert.equal(known.has(slug), true, target);
  }
});

test("the app host sends marketing paths to the apex and leaves the board alone", () => {
  assert.equal(isAppHostname("app.pickuproster.com", "pickuproster.com"), true);
  assert.equal(isAppHostname("maple.pickuproster.com", "pickuproster.com"), false);
  assert.equal(isAppHostname("pickuproster.com", "pickuproster.com"), false);
  assert.equal(isAppMarketingPath("/blog/best-school-dismissal-software"), true);
  assert.equal(isAppMarketingPath("/pricing"), true);
  assert.equal(isAppMarketingPath("/signup"), true);
  assert.equal(isAppMarketingPath("/"), false);
  assert.equal(isAppMarketingPath("/forgot-password"), false);
  assert.equal(isAppMarketingPath("/viewer-access"), false);

  assert.deepEqual(
    indexingAction({
      pathname: "/pricing",
      hostname: "app.pickuproster.com",
      rootDomain: "pickuproster.com",
      slugs,
    }),
    { type: "redirect", path: "/pricing", preserveSearch: true },
  );
  assert.deepEqual(
    indexingAction({
      pathname: "/signup",
      hostname: "app.pickuproster.com",
      rootDomain: "pickuproster.com",
      slugs,
    }),
    { type: "redirect", path: "/signup", preserveSearch: true },
  );
  assert.equal(
    indexingAction({
      pathname: "/forgot-password",
      hostname: "app.pickuproster.com",
      rootDomain: "pickuproster.com",
      slugs,
    }),
    null,
  );
  assert.deepEqual(
    indexingAction({
      pathname: "/content/guides/2026-04-24-importing-student-rosters-from-sis.md",
      hostname: "app.pickuproster.com",
      rootDomain: "pickuproster.com",
      slugs,
    }),
    {
      type: "redirect",
      path: "/guides/importing-student-rosters-from-sis",
      preserveSearch: false,
    },
  );
  assert.equal(
    indexingAction({
      pathname: "/pricing",
      hostname: "maple.pickuproster.com",
      rootDomain: "pickuproster.com",
      slugs,
    }),
    null,
  );
});

test("auth and manifest URLs are noindex and stay out of the sitemap", () => {
  assert.equal(marketingNoindexHeader("/login"), "noindex, follow");
  assert.equal(marketingNoindexHeader("/signup"), "noindex, follow");
  assert.equal(marketingNoindexHeader("/forgot-password"), "noindex, follow");
  assert.equal(marketingNoindexHeader("/viewer-access"), "noindex, follow");
  assert.equal(marketingNoindexHeader("/__manifest"), "noindex");
  assert.equal(marketingNoindexHeader("/pricing"), null);
  for (const path of [
    "/login",
    "/signup",
    "/forgot-password",
    "/viewer-access",
    "/__manifest",
    "/content/blog/post.md",
    "/guides/handling-early-dismissal-requests",
    "/blog/structured-lanes-that-actually-cut-car-line-wait-times",
    "/admin",
  ]) {
    assert.equal(sitemapPathIsIndexable(path), false, path);
  }
  for (const path of SITEMAP_STATIC_PATHS) {
    assert.equal(sitemapPathIsIndexable(path), true, path);
  }
  for (const slug of blog.slugs) {
    assert.equal(sitemapPathIsIndexable(`/blog/${slug}`), true, slug);
  }
  for (const slug of guides.slugs) {
    assert.equal(sitemapPathIsIndexable(`/guides/${slug}`), true, slug);
  }
});
