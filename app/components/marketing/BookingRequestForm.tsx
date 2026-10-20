import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { SlotPicker, type SlotChoice } from "~/components/marketing/SlotPicker";
import { TurnstileField } from "~/components/marketing/TurnstileField";
import { zoomJoinDetails } from "~/lib/site";

const inputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-[#E9D500]";

export function BookingRequestForm({
  kind,
  slots,
  siteKey,
  locale,
  errorCode,
  sent,
  whenLabel,
  meetingUrl,
  requireRole,
}: {
  kind: "demo" | "intro";
  slots: SlotChoice[];
  siteKey: string | null;
  locale: string;
  errorCode: string | null;
  sent: boolean;
  whenLabel: string;
  meetingUrl: string | null;
  requireRole: boolean;
}) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const sending = navigation.state === "submitting";
  const zoom = zoomJoinDetails(meetingUrl);

  if (sent) {
    return (
      <div className="mt-10 rounded-2xl border border-[#E9D500]/40 bg-[#E9D500]/10 p-6">
        <h2 className="text-2xl font-bold text-[#E9D500]">{t("booking.confirmTitle")}</h2>
        <p className="mt-2 text-white/80">
          {whenLabel ? t("booking.confirmBody", { when: whenLabel }) : t("booking.confirmBodyPlain")}
        </p>
        {meetingUrl ? (
          <p className="mt-4 text-white/80">
            <a href={meetingUrl} className="font-semibold text-[#E9D500] underline">
              {t("booking.joinZoom")}
            </a>
            {zoom ? (
              <>
                <br />
                {t("booking.meetingId", { id: zoom.id })}
                <br />
                {t("booking.meetingPasscode", { passcode: zoom.passcode })}
              </>
            ) : null}
          </p>
        ) : null}
        <Link to="/pricing" className="mt-6 inline-flex text-sm font-semibold text-[#E9D500] underline">
          {t("marketingLanding.viewPricing")}
        </Link>
      </div>
    );
  }

  return (
    <Form method="post" className="mt-10 space-y-4">
      <SlotPicker
        slots={slots}
        locale={locale}
        legend={t("booking.pickTime")}
        zoneLead={t("booking.zoneLead")}
        empty={t("booking.noTimes")}
      />
      <Field label={t("demo.name")} name="name" required />
      <Field label={t("demo.role")} name="role" required={requireRole} />
      <Field label={t("demo.school")} name="school" required />
      <Field label={t("demo.email")} name="email" type="email" required />
      <Field label={t("demo.phone")} name="phone" type="tel" />
      {kind === "demo" ? <Field label={t("demo.studentCount")} name="studentCount" /> : null}
      <label className="block text-sm font-medium text-white/80">
        {t("demo.message")}
        <textarea name="message" rows={4} className={inputClass} />
      </label>
      <label className="absolute left-[-9999px]" aria-hidden="true">
        {t("demo.honeypot")}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <TurnstileField siteKey={siteKey} action={kind} resetKey={errorCode ?? "ready"} />
      {errorCode ? (
        <p className="text-sm text-red-300" role="alert">
          {t(`booking.errors.${errorCode}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={sending || slots.length === 0}
        className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] transition hover:bg-[#f5e047] disabled:opacity-60"
      >
        {sending ? t("demo.sending") : t("booking.submit")}
      </button>
    </Form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-white/80">
      {label}
      <input name={name} type={type} required={required} className={inputClass} />
    </label>
  );
}
