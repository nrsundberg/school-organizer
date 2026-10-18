import { Form, Link, useNavigation, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/demo";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { notifyDemoRequest } from "~/domain/email/demo-notify.server";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import { parseDemoForm, type DemoFormError } from "~/lib/demo-form";
import {
  canonicalUrl,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";
import { getDemoBookingUrl } from "~/lib/site";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export const handle = { i18n: ["common"] };

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "https://pickuproster.com";
  return marketingPageMeta({
    title: data?.metaTitle ?? "Book a demo — PickupRoster",
    description:
      data?.metaDescription ??
      "Tell us about your school and we'll show you the live pickup board.",
    canonical: data?.canonical ?? canonicalUrl(origin, "/demo"),
    origin,
    image: true,
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/demo`);
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "common");
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  return {
    origin,
    canonical: canonicalUrl(origin, "/demo"),
    metaTitle: t("demo.metaTitle"),
    metaDescription: t("demo.metaDescription"),
    bookingUrl: getDemoBookingUrl(context),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = parseDemoForm(form);
  const limit = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: `demo:${clientIpFromRequest(request)}`,
  });
  if (!limit.ok) return { status: "error" as const, code: "rate" as const };
  if (!parsed.ok) return { status: "error" as const, code: parsed.error };
  if (!parsed.honeypot) {
    await notifyDemoRequest(context, parsed.value, new Date());
  }
  return { status: "sent" as const };
}

const inputClass =
  "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-[#E9D500]";

export default function DemoPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const sending = navigation.state === "submitting";
  const sent = actionData?.status === "sent";
  const errorCode =
    actionData?.status === "error" ? actionData.code : null;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">{t("demo.heading")}</h1>
        <p className="mt-3 text-lg text-white/70">{t("demo.lede")}</p>

        {loaderData.bookingUrl ? (
          <a
            href={loaderData.bookingUrl}
            className="mt-6 inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/90 transition hover:border-white/40"
          >
            {t("demo.pickTime")}
          </a>
        ) : null}

        {sent ? (
          <div className="mt-10 rounded-2xl border border-[#E9D500]/40 bg-[#E9D500]/10 p-6">
            <h2 className="text-2xl font-bold text-[#E9D500]">
              {t("demo.confirmTitle")}
            </h2>
            <p className="mt-2 text-white/80">{t("demo.confirmBody")}</p>
            <Link
              to="/pricing"
              className="mt-6 inline-flex text-sm font-semibold text-[#E9D500] underline"
            >
              {t("marketingLanding.viewPricing")}
            </Link>
          </div>
        ) : (
          <Form method="post" className="mt-10 space-y-4">
            <Field label={t("demo.name")} name="name" required />
            <Field label={t("demo.role")} name="role" required />
            <Field label={t("demo.school")} name="school" required />
            <Field label={t("demo.email")} name="email" type="email" required />
            <Field label={t("demo.phone")} name="phone" type="tel" />
            <Field label={t("demo.studentCount")} name="studentCount" />
            <label className="block text-sm font-medium text-white/80">
              {t("demo.message")}
              <textarea name="message" rows={4} className={inputClass} />
            </label>
            <label className="absolute left-[-9999px]" aria-hidden="true">
              {t("demo.honeypot")}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
            {errorCode ? (
              <p className="text-sm text-red-300" role="alert">
                {t(`demo.errors.${errorCode as DemoFormError | "rate"}`)}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] transition hover:bg-[#f5e047] disabled:opacity-60"
            >
              {sending ? t("demo.sending") : t("demo.submit")}
            </button>
          </Form>
        )}
      </div>
    </div>
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
      <input
        name={name}
        type={type}
        required={required}
        className={inputClass}
      />
    </label>
  );
}
