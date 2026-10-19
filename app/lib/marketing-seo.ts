/**
 * Marketing SEO helpers: sitemap, robots, canonical host, and JSON-LD.
 *
 * School subdomains and custom domains are not the marketing site. Sitemap
 * URLs always use the public apex, and tenant robots.txt disallows the
 * whole host so a private board is not offered to crawlers.
 */

import type { MetaDescriptor } from "react-router";
import { PUBLIC_PLAN_PRICES } from "~/domain/billing/public-prices";

export const OG_SHARE_PATH = "/og-share.png";

/** Pages listed in the marketing sitemap besides individual posts and guides. */
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/pricing",
  "/faqs",
  "/guides",
  "/blog",
  "/demo",
  "/book/intro",
  "/school-pickup-board",
  "/compare/pikmykid-alternatives",
  "/compare/schoolpass-vs-pickuproster",
] as const;

/** lastmod for static marketing URLs that have a known publish date. */
export const SITEMAP_PATH_LASTMOD: Partial<
  Record<(typeof SITEMAP_STATIC_PATHS)[number], string>
> = {
  "/compare/pikmykid-alternatives": "2026-10-18",
  "/compare/schoolpass-vs-pickuproster": "2026-10-18",
};

/** App and auth prefixes a marketing robots.txt must disallow. */
export const ROBOTS_DISALLOW_PATHS = [
  "/login",
  "/signup",
  "/book/manage",
  "/admin",
  "/forgot-password",
  "/reset-password",
  "/set-password",
  "/accept-invite",
  "/viewer-access",
  "/logout",
  "/api/",
  "/platform",
  "/district",
  "/billing",
  "/create",
  "/edit",
  "/update/",
  "/empty/",
  "/data/",
  "/homerooms",
  "/drills",
  "/ws",
] as const;

export type SitemapEntry = {
  path: string;
  /** YYYY-MM-DD from the post or guide. Omitted when unknown. */
  lastmod?: string | null;
};

const LASTMOD = /^\d{4}-\d{2}-\d{2}$/;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** https://pickuproster.com for a real apex. Local hosts keep the request origin. */
export function publicSiteOrigin(
  request: Request,
  rootDomain: string | undefined,
): string {
  const root = (rootDomain ?? "").trim().toLowerCase();
  if (root && root !== "localhost" && !root.endsWith(".localhost")) {
    return `https://${root}`;
  }
  return new URL(request.url).origin;
}

export function shareImageUrl(origin: string): string {
  return `${origin}${OG_SHARE_PATH}`;
}

export function canonicalUrl(origin: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${origin}${path === "/" ? "/" : path.replace(/\/+$/, "")}`;
}

/**
 * 301 target when the request is `www.<apex>` or plain HTTP on the apex.
 * Tenant hosts and local dev hosts are left alone. Returns null when the
 * request is already the https apex.
 */
export function canonicalRedirectTarget(
  request: Request,
  rootDomain: string | undefined,
): string | null {
  const root = (rootDomain ?? "").trim().toLowerCase();
  if (!root || root === "localhost" || root.endsWith(".localhost")) return null;

  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host !== root && host !== `www.${root}`) return null;

  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").toLowerCase();
  const insecure = forwarded === "http" || url.protocol === "http:";
  const isWww = host === `www.${root}`;
  if (!isWww && !insecure) return null;

  url.protocol = "https:";
  url.hostname = root;
  url.port = "";
  return url.toString();
}

export function buildSitemapXml(origin: string, entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const loc = xmlEscape(`${origin}${entry.path === "/" ? "/" : entry.path}`);
      const lastmod =
        entry.lastmod && LASTMOD.test(entry.lastmod)
          ? `\n    <lastmod>${entry.lastmod}</lastmod>`
          : "";
      return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function marketingRobotsTxt(sitemapUrl: string): string {
  const disallows = ROBOTS_DISALLOW_PATHS.map((path) => `Disallow: ${path}`).join(
    "\n",
  );
  return `User-agent: *\nAllow: /\n${disallows}\nSitemap: ${sitemapUrl}\n`;
}

export function tenantRobotsTxt(): string {
  return "User-agent: *\nDisallow: /\n";
}

export function organizationWebSiteJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "PickupRoster",
        url: origin,
        logo: `${origin}/logo-512.png`,
        email: "support@pickuproster.com",
      },
      {
        "@type": "WebSite",
        name: "PickupRoster",
        url: origin,
      },
    ],
  };
}

/** Organization, WebSite, and the home-page FAQ in one graph. */
export function homePageJsonLd(
  origin: string,
  faqs: readonly { q: string; a: string }[],
) {
  const base = organizationWebSiteJsonLd(origin);
  const faq = faqPageJsonLd(faqs);
  const { "@context": _context, ...faqNode } = faq;
  return {
    ...base,
    "@graph": [...base["@graph"], faqNode],
  };
}

export function softwareApplicationJsonLd(origin: string) {
  const car = PUBLIC_PLAN_PRICES.CAR_LINE;
  const campus = PUBLIC_PLAN_PRICES.CAMPUS;
  const dollars = (price: number) =>
    `$${price.toLocaleString("en-US")}`;
  const offer = (name: string, price: number, unit: string) => ({
    "@type": "Offer",
    name,
    price: String(price),
    priceCurrency: "USD",
    url: `${origin}/pricing`,
    description: `${dollars(price)} ${unit}`,
  });
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PickupRoster",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: origin,
    offers: [
      offer("Car Line monthly", car.monthlyDollars, "per month"),
      offer("Car Line annual", car.annualDollars, "per year"),
      offer("Campus monthly", campus.monthlyDollars, "per month"),
      offer("Campus annual", campus.annualDollars, "per year"),
    ],
  };
}

export function rootDomainFromContext(context: any): string | undefined {
  const fromContext = context?.cloudflare?.env?.PUBLIC_ROOT_DOMAIN;
  if (typeof fromContext === "string" && fromContext.trim()) return fromContext;
  const fromProcess = process.env.PUBLIC_ROOT_DOMAIN;
  return typeof fromProcess === "string" && fromProcess.trim()
    ? fromProcess
    : undefined;
}

/** Title, description, canonical, and optional social / JSON-LD tags. */
export function marketingPageMeta(input: {
  title: string;
  description: string;
  canonical: string;
  origin?: string;
  image?: boolean;
  noindex?: boolean;
  type?: string;
  jsonLd?: unknown;
}): MetaDescriptor[] {
  const tags: MetaDescriptor[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { tagName: "link", rel: "canonical", href: input.canonical },
  ];
  if (input.noindex) {
    tags.push({ name: "robots", content: "noindex, follow" });
  }
  if (input.image && input.origin) {
    const image = shareImageUrl(input.origin);
    tags.push(
      { property: "og:title", content: input.title },
      { property: "og:description", content: input.description },
      { property: "og:type", content: input.type ?? "website" },
      { property: "og:url", content: input.canonical },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: input.title },
      { name: "twitter:description", content: input.description },
      { name: "twitter:image", content: image },
    );
  }
  if (input.jsonLd !== undefined) {
    const blocks = Array.isArray(input.jsonLd) ? input.jsonLd : [input.jsonLd];
    for (const block of blocks) {
      tags.push({ "script:ld+json": block } as MetaDescriptor);
    }
  }
  return tags;
}

export function articleJsonLd(input: {
  headline: string;
  description: string;
  url: string;
  dateModified: string;
  datePublished?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    dateModified: input.dateModified,
    datePublished: input.datePublished ?? input.dateModified,
    author: { "@type": "Organization", name: "PickupRoster" },
    publisher: { "@type": "Organization", name: "PickupRoster" },
    mainEntityOfPage: input.url,
  };
}

export function itemListJsonLd(names: readonly string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: names.length,
    itemListElement: names.map((name, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
    })),
  };
}

export function faqPageJsonLd(items: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
