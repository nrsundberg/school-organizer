import { Link } from "react-router";
import { useTranslation } from "react-i18next";

type Props = {
  /** ISO instant for calendar day shown as suspension date (pastDueSinceAt + 14d UTC). */
  suspendOnIso: string;
};

function formatCalendarDay(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PastDuePaymentBanner({ suspendOnIso }: Props) {
  const { t, i18n } = useTranslation("admin");
  const suspendLabel = formatCalendarDay(suspendOnIso, i18n.language);

  return (
    <div className="border-b border-amber-500/40 bg-amber-950/80 px-4 py-2.5 text-sm">
      <p className="font-medium text-white">
        {t("pastDueBanner.headline")}
      </p>
      <p className="mt-1 text-white/80">
        {t("pastDueBanner.body")}
        <span className="font-semibold text-white">{suspendLabel}</span>
        {t("pastDueBanner.suffix")}
      </p>
      <p className="mt-2">
        <Link
          to="/pricing"
          className="text-[#E9D500] underline underline-offset-2 hover:text-[#f5e047]"
        >
          {t("pastDueBanner.updateBilling")}
        </Link>
      </p>
    </div>
  );
}
