import { useEffect, useRef, useState } from "react";
import { useActionData, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { data } from "react-router";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/branding";
import { getPrisma } from "~/db.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext } from "~/domain/utils/global-context.server";
import { recordOrgAudit } from "~/domain/billing/comp.server";
import {
  buildOrgLogoObjectKey,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  HEX_COLOR_RE,
  isValidHexColor,
  validateLogoUpload,
} from "~/domain/org/branding.server";
import { planAllowsAdvancedBranding } from "~/lib/plan-limits";

const HEX_COLOR = HEX_COLOR_RE;
// lowercase domain validator; allows empty string to clear
const DOMAIN_RE = /^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

export const meta: Route.MetaFunction = () => [{ title: "Branding Settings" }];

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  // Prisma generate isn't run in the sandbox, so the generated Org type
  // doesn't yet carry the new primaryColor / secondaryColor columns.
  const orgLoose = org as typeof org & {
    primaryColor?: string | null;
    secondaryColor?: string | null;
  };
  return {
    orgName: org.name,
    orgSlug: org.slug,
    brandColor: org.brandColor ?? "#60A5FA",
    brandAccentColor: org.brandAccentColor ?? "#E9D500",
    primaryColor: orgLoose.primaryColor ?? null,
    secondaryColor: orgLoose.secondaryColor ?? null,
    defaultPrimaryColor: DEFAULT_PRIMARY_COLOR,
    defaultSecondaryColor: DEFAULT_SECONDARY_COLOR,
    logoUrl: org.logoObjectKey ? `/api/branding/logo/${org.slug}` : org.logoUrl ?? null,
    customDomain: org.customDomain ?? "",
    advancedBrandingAllowed: planAllowsAdvancedBranding(org.billingPlan),
    billingPlan: org.billingPlan,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const db = getPrisma(context);

  const formData = await request.formData();
  const brandColor = String(formData.get("brandColor") ?? "").trim();
  const brandAccentColor = String(formData.get("brandAccentColor") ?? "").trim();
  const rawPrimary = String(formData.get("primaryColor") ?? "").trim();
  const rawSecondary = String(formData.get("secondaryColor") ?? "").trim();
  const resetPrimary = formData.get("resetPrimary") === "true";
  const resetSecondary = formData.get("resetSecondary") === "true";
  const clearLogo = formData.get("clearLogo") === "true";
  const logo = formData.get("logo");
  const logoFile = logo instanceof File && logo.size > 0 ? logo : null;
  const rawDomain = String(formData.get("customDomain") ?? "").trim().toLowerCase();

  // Advanced branding (custom domain + logo upload) is CAMPUS+.
  // Drop any logo / domain inputs silently for lower tiers so a crafted
  // form post can't bypass the UI gate; colors still go through.
  const advancedBrandingAllowed = planAllowsAdvancedBranding(org.billingPlan);
  const attemptedAdvancedChange =
    !!logoFile ||
    clearLogo ||
    rawDomain !== (org.customDomain ?? "").toLowerCase();
  if (!advancedBrandingAllowed && attemptedAdvancedChange) {
    return data(
      {
        error:
          "Custom domain and logo upload require the Campus or District plan.",
      },
      { status: 403 },
    );
  }

  if (!HEX_COLOR.test(brandColor) || !HEX_COLOR.test(brandAccentColor)) {
    return dataWithError(null, "Brand colors must use full hex format like #1A2B3C.");
  }

  // Palette overrides: reset wins over a provided value. A submitted value
  // must either be empty/omitted (leave column alone) or a valid hex string.
  let primaryColorUpdate: string | null | undefined;
  if (resetPrimary) {
    primaryColorUpdate = null;
  } else if (rawPrimary !== "") {
    if (!isValidHexColor(rawPrimary)) {
      return dataWithError(null, "Primary color must use full hex format like #1A2B3C.");
    }
    primaryColorUpdate = rawPrimary.toUpperCase();
  }

  let secondaryColorUpdate: string | null | undefined;
  if (resetSecondary) {
    secondaryColorUpdate = null;
  } else if (rawSecondary !== "") {
    if (!isValidHexColor(rawSecondary)) {
      return dataWithError(null, "Secondary color must use full hex format like #1A2B3C.");
    }
    secondaryColorUpdate = rawSecondary.toUpperCase();
  }

  // Validate custom domain (empty string = clear it)
  if (rawDomain !== "" && !DOMAIN_RE.test(rawDomain)) {
    return data({ error: "Invalid domain format. Use lowercase letters, numbers, and hyphens (e.g. myschool.example.com)." }, { status: 400 });
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

  const updateData: {
    brandColor: string;
    brandAccentColor: string;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    logoObjectKey?: string | null;
    logoUrl?: string | null;
    customDomain?: string | null;
  } = {
    brandColor: brandColor.toUpperCase(),
    brandAccentColor: brandAccentColor.toUpperCase(),
  };
  if (logoObjectKey !== undefined) updateData.logoObjectKey = logoObjectKey;
  if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
  if (primaryColorUpdate !== undefined) updateData.primaryColor = primaryColorUpdate;
  if (secondaryColorUpdate !== undefined) updateData.secondaryColor = secondaryColorUpdate;

  // Handle custom domain update
  const prevDomain = org.customDomain ?? null;
  const nextDomain = rawDomain === "" ? null : rawDomain;
  updateData.customDomain = nextDomain;

  try {
    await db.org.update({
      where: { id: org.id },
      // Cast: the generated Prisma types in the sandbox predate the
      // primaryColor / secondaryColor columns from migration 0016. Once
      // `prisma generate` runs in CI the cast is a harmless no-op.
      data: updateData as unknown as Parameters<typeof db.org.update>[0]["data"],
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return data({ error: "That domain is in use by another org." }, { status: 400 });
    }
    throw e;
  }

  // Audit custom domain change if it changed
  if (prevDomain !== nextDomain) {
    await recordOrgAudit({
      context,
      orgId: org.id,
      actorUserId: me.id,
      action: "branding.custom_domain",
      payload: { from: prevDomain, to: nextDomain },
    });
  }

  return dataWithSuccess(null, "Branding updated.");
}

export default function AdminBranding({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isPending = navigation.state === "submitting";
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Live-preview values for the palette override pickers. `null` means
  // "no override set" — the swatch displays the default palette value.
  const [primaryOverride, setPrimaryOverride] = useState<string | null>(
    loaderData.primaryColor,
  );
  const [secondaryOverride, setSecondaryOverride] = useState<string | null>(
    loaderData.secondaryColor,
  );
  // Reset-requested flags flow to hidden inputs so the action can null the
  // column. Without a pending reset, an empty color input is treated as
  // "no change" by the server.
  const [resetPrimary, setResetPrimary] = useState(false);
  const [resetSecondary, setResetSecondary] = useState(false);

  // Clean up object URL on unmount or when a new one is created
  useEffect(() => {
    return () => {
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }
    };
  }, [logoPreviewUrl]);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (logoPreviewUrl) {
      URL.revokeObjectURL(logoPreviewUrl);
    }
    if (file) {
      setLogoPreviewUrl(URL.createObjectURL(file));
    } else {
      setLogoPreviewUrl(null);
    }
  }

  // domain-level error from action (non-toast errors)
  const domainError =
    actionData && "error" in actionData ? (actionData as { error: string }).error : null;

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

        {/* Site palette overrides — drive --color-primary / --color-secondary. */}
        <fieldset className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <legend className="px-1 text-sm font-semibold text-white">Site palette</legend>
          <p className="text-xs text-white/50">
            Override the default site palette for your tenant. Leave unset to use the defaults
            ({loaderData.defaultPrimaryColor} / {loaderData.defaultSecondaryColor}).
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PaletteColorField
              label="Primary color"
              inputName="primaryColor"
              resetName="resetPrimary"
              defaultColor={loaderData.defaultPrimaryColor}
              overrideValue={primaryOverride}
              reset={resetPrimary}
              onPick={(hex) => {
                setResetPrimary(false);
                setPrimaryOverride(hex);
              }}
              onReset={() => {
                setResetPrimary(true);
                setPrimaryOverride(null);
              }}
            />
            <PaletteColorField
              label="Secondary color"
              inputName="secondaryColor"
              resetName="resetSecondary"
              defaultColor={loaderData.defaultSecondaryColor}
              overrideValue={secondaryOverride}
              reset={resetSecondary}
              onPick={(hex) => {
                setResetSecondary(false);
                setSecondaryOverride(hex);
              }}
              onReset={() => {
                setResetSecondary(true);
                setSecondaryOverride(null);
              }}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70 flex flex-col gap-2">
            Logo (PNG, JPEG, WEBP up to 2MB)
            <input
              ref={logoInputRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoChange}
              className="rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          {/* Browser-side logo preview before upload */}
          {logoPreviewUrl && (
            <div className="mt-2 flex items-center gap-3">
              <img
                src={logoPreviewUrl}
                alt="Logo preview"
                className="h-14 w-14 rounded bg-black/20 object-contain border border-white/10"
              />
              <span className="text-xs text-white/50">Preview (not yet saved)</span>
            </div>
          )}
          {loaderData.logoUrl && !logoPreviewUrl ? (
            <div className="mt-2 flex items-center gap-3">
              <img src={loaderData.logoUrl} alt="Current tenant logo" className="h-14 w-14 rounded bg-black/20 object-contain" />
              <label className="inline-flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" name="clearLogo" value="true" />
                Remove current logo
              </label>
            </div>
          ) : null}
        </div>

        {/* Custom domain */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70 flex flex-col gap-2">
            Custom domain
            <input
              type="text"
              name="customDomain"
              defaultValue={loaderData.customDomain}
              placeholder="e.g. pickup.myschool.org"
              className="rounded border border-white/15 bg-white/5 px-3 py-2 text-white text-sm placeholder:text-white/30"
            />
          </label>
          {domainError ? (
            <p className="text-sm text-red-400">{domainError}</p>
          ) : (
            <p className="text-xs text-white/40">
              DNS must point to pickuproster.com with a proxied record. Leave blank to use the
              default subdomain.
            </p>
          )}
          {loaderData.customDomain && !domainError && (
            <p className="text-xs text-white/50">
              Current: <span className="text-white font-mono">{loaderData.customDomain}</span>
            </p>
          )}
        </div>

        <Button type="submit" variant="primary" className="self-start" isPending={isPending}>
          Save branding
        </Button>
      </form>
    </div>
  );
}

type PaletteColorFieldProps = {
  label: string;
  inputName: string;
  resetName: string;
  defaultColor: string;
  overrideValue: string | null;
  reset: boolean;
  onPick: (hex: string) => void;
  onReset: () => void;
};

/**
 * One palette override row: color input + live swatch + "Reset to default".
 * The displayed swatch falls back to `defaultColor` when no override is set.
 */
function PaletteColorField({
  label,
  inputName,
  resetName,
  defaultColor,
  overrideValue,
  reset,
  onPick,
  onReset,
}: PaletteColorFieldProps) {
  const displayed = overrideValue ?? defaultColor;
  const isOverride = overrideValue !== null && !reset;
  return (
    <div className="flex flex-col gap-2 text-sm text-white/70">
      <span>{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="color"
          name={inputName}
          value={displayed}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          className="h-10 w-16 rounded border border-white/15 bg-white/5 p-1"
        />
        <span
          aria-hidden="true"
          className="inline-block h-8 w-8 rounded border border-white/15"
          style={{ background: displayed }}
        />
        <span className="font-mono text-xs text-white/70">{displayed}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/40">
          {isOverride ? "Overriding default" : `Using default ${defaultColor}`}
        </span>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-white/15 px-2 py-0.5 text-white/70 hover:text-white hover:border-white/30"
        >
          Reset to default
        </button>
      </div>
      {/* Hidden flag: when true, action will null the DB column. */}
      <input type="hidden" name={resetName} value={reset ? "true" : "false"} />
    </div>
  );
}
