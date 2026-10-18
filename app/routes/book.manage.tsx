import { Form, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/book.manage";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { SlotPicker } from "~/components/marketing/SlotPicker";
import { actOnManagedBooking, loadManagedBooking } from "~/domain/booking/flow.server";
import { formatSlotRange } from "~/domain/booking/rules";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import { marketingPageMeta, publicSiteOrigin, rootDomainFromContext } from "~/lib/marketing-seo";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["common"] };

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "https://pickuproster.com";
  return [
    ...marketingPageMeta({
      title: "Cancel or reschedule — PickupRoster",
      description: "Change or cancel a PickupRoster demo or intro call.",
      canonical: `${origin}/book/manage`,
      origin,
      image: false,
    }),
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    const target = new URL(request.url);
    throw redirect(
      `${marketingOriginFromRequest(request, context)}${target.pathname}${target.search}`,
    );
  }
  const locale = await detectLocale(request, context);
  const managed = await loadManagedBooking(request, context);
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  if (!managed) {
    return {
      origin,
      locale,
      found: false as const,
      token: "",
      whenLabel: "",
      status: "missing",
      slots: [] as { start: string; end: string }[],
    };
  }
  const label = formatSlotRange(
    managed.booking.startsAt,
    managed.booking.endsAt,
    managed.booking.visitorTimeZone,
    locale,
  );
  return {
    origin,
    locale,
    found: true as const,
    token: managed.token,
    whenLabel: `${label.day}, ${label.time} ${label.zone}`,
    status: managed.booking.status,
    slots: managed.slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const locale = await detectLocale(request, context);
  return actOnManagedBooking({ request, context, locale });
}

export default function ManageBookingPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const sending = navigation.state === "submitting";
  const managed = actionData?.status === "managed" ? actionData : null;
  const showForm =
    loaderData.found &&
    loaderData.status === "confirmed" &&
    !managed &&
    actionData?.status !== "closed";

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">{t("booking.manageHeading")}</h1>
        {managed ? (
          <div className="mt-8 rounded-2xl border border-[#E9D500]/40 bg-[#E9D500]/10 p-6">
            <h2 className="text-2xl font-bold text-[#E9D500]">
              {managed.event === "cancelled" ? t("booking.cancelledTitle") : t("booking.movedTitle")}
            </h2>
            <p className="mt-2 text-white/80">
              {managed.event === "cancelled"
                ? t("booking.cancelledBody")
                : t("booking.movedBody", { when: managed.whenLabel })}
            </p>
          </div>
        ) : showForm ? (
          <>
            <p className="mt-3 text-lg text-white/70">
              {t("booking.manageLede", { when: loaderData.whenLabel })}
            </p>
            <Form method="post" className="mt-8">
              <input type="hidden" name="token" value={loaderData.token} />
              <button
                type="submit"
                name="intent"
                value="cancel"
                disabled={sending}
                className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/90"
              >
                {t("booking.cancel")}
              </button>
            </Form>
            <Form method="post" className="mt-10 space-y-4">
              <input type="hidden" name="token" value={loaderData.token} />
              <input type="hidden" name="intent" value="reschedule" />
              <SlotPicker
                slots={loaderData.slots}
                locale={loaderData.locale}
                legend={t("booking.pickNewTime")}
                zoneLead={t("booking.zoneLead")}
                empty={t("booking.noTimes")}
              />
              {actionData?.status === "error" ? (
                <p className="text-sm text-red-300" role="alert">
                  {t(`booking.errors.${actionData.code}`)}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={sending || loaderData.slots.length === 0}
                className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] disabled:opacity-60"
              >
                {t("booking.reschedule")}
              </button>
            </Form>
          </>
        ) : (
          <p className="mt-6 text-white/70">{t("booking.manageMissing")}</p>
        )}
      </div>
    </div>
  );
}
