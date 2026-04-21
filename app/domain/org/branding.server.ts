import type { Org } from "~/db";
import { getPrisma } from "~/db.server";
import { DEFAULT_SITE_NAME } from "~/lib/site";
import {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_LOGO_URL,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  HEX_COLOR_RE,
  isValidHexColor,
  normalizeHexColor,
} from "./branding-constants";

// Re-export client-safe constants and helpers so existing server-side imports
// keep working. Anything referenced from non-loader/action route exports
// (links, meta, ErrorBoundary, default component) should import from
// `./branding-constants` directly instead.
export {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_LOGO_URL,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  HEX_COLOR_RE,
  isValidHexColor,
  normalizeHexColor,
};

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type OrgBranding = {
  orgId: string | null;
  orgName: string;
  orgSlug: string | null;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  /** Tenant palette override for --color-primary (null = no override). */
  primaryColorOverride: string | null;
  /** Tenant palette override for --color-secondary (null = no override). */
  secondaryColorOverride: string | null;
};

// Preserve prior internal name used by getBrandingFromOrg.
const normalizeColor = normalizeHexColor;

function hostToSlug(host: string): string | null {
  const bareHost = host.split(":")[0].toLowerCase();
  if (!bareHost || bareHost === "localhost") return null;
  const parts = bareHost.split(".");
  if (parts.length < 3) return null;
  const candidate = parts[0]?.trim();
  return candidate || null;
}

export async function resolveOrgFromRequest(context: any, request: Request): Promise<Org | null> {
  const db = getPrisma(context);
  const host = new URL(request.url).host;
  const bareHost = host.split(":")[0].toLowerCase();

  const byCustomDomain = await db.org.findUnique({
    where: { customDomain: bareHost },
  });
  if (byCustomDomain) return byCustomDomain;

  const slug = hostToSlug(host);
  if (slug) {
    const bySlug = await db.org.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }

  const defaultOrg = await db.org.findUnique({ where: { slug: "default" } });
  if (defaultOrg) return defaultOrg;

  return db.org.findFirst({ orderBy: { createdAt: "asc" } });
}

export function getBrandingFromOrg(org: Org | null): OrgBranding {
  const primaryColor = normalizeColor(org?.brandColor) ?? DEFAULT_BRAND_PRIMARY;
  const accentColor = normalizeColor(org?.brandAccentColor) ?? DEFAULT_BRAND_ACCENT;

  // Prisma generate doesn't run in the sandbox, so the generated Org model
  // doesn't know about the new primaryColor / secondaryColor columns yet.
  // Cast once here; once `prisma generate` runs in CI the cast is a no-op.
  const orgLoose = org as (Org & {
    primaryColor?: string | null;
    secondaryColor?: string | null;
  }) | null;

  return {
    orgId: org?.id ?? null,
    orgName: org?.name ?? DEFAULT_SITE_NAME,
    orgSlug: org?.slug ?? null,
    primaryColor,
    accentColor,
    logoUrl: org?.logoObjectKey && org.slug ? `/api/branding/logo/${org.slug}` : org?.logoUrl ?? DEFAULT_LOGO_URL,
    primaryColorOverride: normalizeColor(orgLoose?.primaryColor ?? null),
    secondaryColorOverride: normalizeColor(orgLoose?.secondaryColor ?? null),
  };
}

export function validateLogoUpload(file: File): string | null {
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return "Logo must be PNG, JPEG, or WEBP.";
  }
  if (file.size <= 0) {
    return "Logo file is empty.";
  }
  if (file.size > MAX_LOGO_BYTES) {
    return "Logo must be 2MB or smaller.";
  }
  return null;
}

export async function buildOrgLogoObjectKey(org: Org, file: File): Promise<string> {
  const ext = file.type === "image/png"
    ? "png"
    : file.type === "image/webp"
      ? "webp"
      : "jpg";
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  const random = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `orgs/${org.id}/branding/logo-${Date.now()}-${random}.${ext}`;
}
