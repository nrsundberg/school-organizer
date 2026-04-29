import { Form } from "react-router";
import { useTranslation } from "react-i18next";

type Props = {
  daysRemaining: number;
  /** "CAR_LINE" or "CAMPUS" — used as the hidden plan input on the upgrade form. */
  billingPlan: "CAR_LINE" | "CAMPUS";
};

export function TrialEndingBanner({ daysRemaining, billingPlan }: Props) {
  const { t } = useTranslation("admin");

  return (
    <div className="border-b border-blue-500/40 bg-blue-950/80 px-4 py-2.5 text-sm">
      <p className="font-medium text-white">
        {t("trialEndingBanner.headline", { count: daysRemaining })}
      </p>
      <p className="mt-1 text-white/80">
        {t("trialEndingBanner.body")}
      </p>
      <Form method="post" action="/api/billing/checkout" className="mt-2">
        <input type="hidden" name="plan" value={billingPlan} />
        <button
          type="submit"
          className="text-[#E9D500] underline underline-offset-2 hover:text-[#f5e047]"
        >
          {t("trialEndingBanner.addPaymentMethod")}
        </button>
      </Form>
    </div>
  );
}
