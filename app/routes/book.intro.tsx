import { redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/book.intro";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { BookingRequestForm } from "~/components/marketing/BookingRequestForm";
import { loadOpenSlots, submitPublicBooking } from "~/domain/booking/flow.server";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import {
  canonicalUrl,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export const handle = { i18n: ["common"] };

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "https://pickuproster.com";
  return marketingPageMeta({
    title: data?.metaTitle ?? "Book an intro call — PickupRoster",
    description:
      data?.metaDescription ??
      "Pick a time for one of your two free 30-minute intro calls.",
    canonical: data?.canonical ?? canonicalUrl(origin, "/book/intro"),
    origin,
    image: true,
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/book/intro`);
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  const open = await loadOpenSlots(context, "intro");
  return {
    origin,
    canonical: canonicalUrl(origin, "/book/intro"),
    metaTitle: t("booking.introMetaTitle"),
    metaDescription: t("booking.introMetaDescription"),
    locale,
    siteKey: open.siteKey,
    slots: open.slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const locale = await detectLocale(request, context);
  return submitPublicBooking({ request, context, kind: "intro", locale });
}

export default function IntroBookingPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const sent = actionData?.status === "sent";
  const errorCode = actionData?.status === "error" ? actionData.code : null;
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">{t("booking.introHeading")}</h1>
        <p className="mt-3 text-lg text-white/70">{t("booking.introLede")}</p>
        <BookingRequestForm
          kind="intro"
          slots={loaderData.slots}
          siteKey={loaderData.siteKey}
          locale={loaderData.locale}
          errorCode={errorCode}
          sent={sent}
          whenLabel={actionData?.status === "sent" ? actionData.whenLabel : ""}
          meetingUrl={actionData?.status === "sent" ? actionData.meetingUrl : null}
          requireRole={false}
        />
      </div>
    </div>
  );
}
