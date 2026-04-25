import { useTranslation } from "react-i18next";
import type { Route } from "./+types/billing.cancel";
import { Page } from "~/components/Page";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string } }) {
  return [{ title: data?.metaTitle ?? "Checkout canceled — Pickup Roster" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return { metaTitle: t("billingCancel.metaTitle") };
}

export default function BillingCancel() {
  const { t } = useTranslation("auth");
  return (
    <Page user={false}>
      <div className="min-h-[calc(100vh-40px)] flex items-center justify-center bg-[#212525] text-white px-4">
        <div className="max-w-xl text-center">
          <h1 className="text-2xl font-semibold mb-3">{t("billingCancel.title")}</h1>
          <p className="text-white/70 mb-6">
            {t("billingCancel.body")}
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/pricing"
              className="inline-block rounded-md bg-white px-5 py-2.5 font-medium text-[#212525] hover:bg-white/90"
            >
              {t("billingCancel.backToPricing")}
            </a>
            <a
              href="/admin"
              className="inline-block rounded-md border border-white/30 px-5 py-2.5 font-medium text-white hover:bg-white/10"
            >
              {t("billingCancel.goToAdmin")}
            </a>
          </div>
        </div>
      </div>
    </Page>
  );
}
