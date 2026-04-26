import { redirect } from "react-router";
import type { Route } from "./+types/billing.portal";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById } from "~/domain/district/district.server";
import { createBillingPortalSessionForDistrict } from "~/domain/billing/checkout.server";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  const origin = new URL(request.url).origin;
  const { url } = await createBillingPortalSessionForDistrict({
    context,
    district,
    returnUrl: `${origin}/district/billing`,
  });
  throw redirect(url);
}
