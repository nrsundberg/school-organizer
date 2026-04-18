import { Button } from "@heroui/react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/branding";
import { getPrisma } from "~/db.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext } from "~/domain/utils/global-context.server";
import {
  buildOrgLogoObjectKey,
  validateLogoUpload,
} from "~/domain/org/branding.server";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const meta: Route.MetaFunction = () => [{ title: "Branding Settings" }];

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  return {
    orgName: org.name,
    orgSlug: org.slug,
    brandColor: org.brandColor ?? "#60A5FA",
    brandAccentColor: org.brandAccentColor ?? "#E9D500",
    logoUrl: org.logoObjectKey ? `/api/branding/logo/${org.slug}` : org.logoUrl ?? null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const db = getPrisma(context);

  const formData = await request.formData();
  const brandColor = String(formData.get("brandColor") ?? "").trim();
  const brandAccentColor = String(formData.get("brandAccentColor") ?? "").trim();
  const clearLogo = formData.get("clearLogo") === "true";
  const logo = formData.get("logo");
  const logoFile = logo instanceof File && logo.size > 0 ? logo : null;

  if (!HEX_COLOR.test(brandColor) || !HEX_COLOR.test(brandAccentColor)) {
    return dataWithError(null, "Brand colors must use full hex format like #1A2B3C.");
  }

  let logoObjectKey: string | null | undefined = undefined;
  let logoUrl: string | null | undefined = undefined;

  if (clearLogo) {
    const bucket = (context as any).cloudflare?.env?.ORG_BRANDING_BUCKET as R2Bucket | undefined;
    if (bucket && org.logoObjectKey) {
      await bucket.delete(org.logoObjectKey);
    }
    logoObjectKey = null;
    logoUrl = null;
  } else if (logoFile) {
    const validationError = validateLogoUpload(logoFile);
    if (validationError) {
      return dataWithError(null, validationError);
    }
    const bucket = (context as any).cloudflare?.env?.ORG_BRANDING_BUCKET as R2Bucket | undefined;
    if (!bucket) {
      return dataWithError(null, "Logo storage is not configured.");
    }
    const objectKey = await buildOrgLogoObjectKey(org, logoFile);
    await bucket.put(objectKey, await logoFile.arrayBuffer(), {
      httpMetadata: { contentType: logoFile.type },
    });
    if (org.logoObjectKey) {
      await bucket.delete(org.logoObjectKey);
    }
    logoObjectKey = objectKey;
    logoUrl = `/api/branding/logo/${org.slug}`;
  }

  const data: {
    brandColor: string;
    brandAccentColor: string;
    logoObjectKey?: string | null;
    logoUrl?: string | null;
  } = {
    brandColor: brandColor.toUpperCase(),
    brandAccentColor: brandAccentColor.toUpperCase(),
  };
  if (logoObjectKey !== undefined) data.logoObjectKey = logoObjectKey;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;

  await db.org.update({
    where: { id: org.id },
    data,
  });

  return dataWithSuccess(null, "Branding updated.");
}

export default function AdminBranding({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Branding</h1>
      <p className="text-sm text-white/60">
        Tenant: <span className="text-white">{loaderData.orgName}</span> ({loaderData.orgSlug})
      </p>

      <form method="post" encType="multipart/form-data" className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70 flex flex-col gap-2">
            Primary color
            <input
              type="color"
              name="brandColor"
              defaultValue={loaderData.brandColor}
              className="h-10 w-full rounded border border-white/15 bg-white/5 p-1"
              required
            />
          </label>
          <label className="text-sm text-white/70 flex flex-col gap-2">
            Accent color
            <input
              type="color"
              name="brandAccentColor"
              defaultValue={loaderData.brandAccentColor}
              className="h-10 w-full rounded border border-white/15 bg-white/5 p-1"
              required
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70 flex flex-col gap-2">
            Logo (PNG, JPEG, WEBP up to 2MB)
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              className="rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          {loaderData.logoUrl ? (
            <div className="mt-2 flex items-center gap-3">
              <img src={loaderData.logoUrl} alt="Current tenant logo" className="h-14 w-14 rounded bg-black/20 object-contain" />
              <label className="inline-flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" name="clearLogo" value="true" />
                Remove current logo
              </label>
            </div>
          ) : null}
        </div>

        <Button type="submit" variant="primary" className="self-start">
          Save branding
        </Button>
      </form>
    </div>
  );
}
