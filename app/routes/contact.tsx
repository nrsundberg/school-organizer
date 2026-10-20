import { data, Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/contact";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { TurnstileField } from "~/components/marketing/TurnstileField";
import { turnstileSiteKey } from "~/domain/booking/turnstile";
import { requireHuman } from "~/domain/help/access.server";
import { helpRateLimitKeys, parseTicketDraft } from "~/domain/help/guardrails";
import { TURNSTILE_ACTION_CONTACT } from "~/domain/help/limits";
import { submitPublicTicket } from "~/domain/help/submit-ticket.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import {
  isMarketingHost,
  marketingOriginFromRequest,
} from "~/domain/utils/host.server";
import { getSupportEmail } from "~/lib/site";
import {
  canonicalUrl,
  marketingPageMeta,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";

export function meta({
  data: loaderData,
}: {
  data?: { canonical?: string; origin?: string };
}) {
  const origin = loaderData?.origin ?? "https://pickuproster.com";
  return marketingPageMeta({
    title: "Contact support — PickupRoster",
    description: "Ask about signup, pricing, or the 30-day free trial.",
    canonical: loaderData?.canonical ?? canonicalUrl(origin, "/contact"),
    origin,
    image: true,
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/contact`);
  }
  const origin = publicSiteOrigin(request, rootDomainFromContext(context));
  return {
    supportEmail: getSupportEmail(context),
    siteKey: turnstileSiteKey(context),
    origin,
    canonical: canonicalUrl(origin, "/contact"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/contact`);
  }

  const form = await request.formData();
  const parsed = parseTicketDraft({
    name: form.get("name"),
    email: form.get("email"),
    message: form.get("message"),
    source: "contact",
    pagePath: "/contact",
    honeypot: form.get("company_website"),
  });
  if (!parsed.ok) {
    return data({ ok: false as const, error: parsed.error, field: parsed.field }, { status: 400 });
  }
  if (parsed.dropped) {
    return data({ ok: true as const, email: "" });
  }

  const limiter = getRateLimiter(context, "RL_CONTACT");
  for (const key of helpRateLimitKeys("contact", clientIpFromRequest(request), null)) {
    const limit = await checkRateLimit({ limiter, key });
    if (!limit.ok) {
      return data(
        { ok: false as const, error: "Too many messages. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  const human = await requireHuman({
    source: context,
    request,
    token: form.get("cf-turnstile-response"),
    expectedAction: TURNSTILE_ACTION_CONTACT,
  });
  if (!human.ok) {
    return data({ ok: false as const, error: human.error }, { status: 403 });
  }

  try {
    await submitPublicTicket({ context, request, draft: parsed.value });
  } catch (err) {
    console.error("[contact] save failed", err instanceof Error ? err.name : "error");
    return data(
      { ok: false as const, error: "We couldn't send that. Please try again in a minute." },
      { status: 500 },
    );
  }
  return data({ ok: true as const, email: parsed.value.email });
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40";

export default function Contact({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const sent = result && "ok" in result && result.ok;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">Contact support</h1>
        <p className="mt-3 text-lg text-white/70">
          Questions about signup, pricing, or the 30-day free trial. You can also use the help
          chat on any page.
        </p>

        {sent ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-[#151a1a] p-6">
            <h2 className="text-xl font-semibold text-[#E9D500]">Message sent</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              {result.email
                ? `Thanks — we'll reply to ${result.email}.`
                : "Thanks — we've got your message."}
            </p>
            <p className="mt-4 text-sm text-white/60">
              Or email{" "}
              <a className="text-[#E9D500] underline" href={`mailto:${loaderData.supportEmail}`}>
                {loaderData.supportEmail}
              </a>
              .
            </p>
          </div>
        ) : (
          <Form method="post" className="mt-10 space-y-4" noValidate>
            {result && "error" in result && result.error ? (
              <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-200" role="alert">
                {result.error}
              </p>
            ) : null}
            <label className="block text-sm font-medium text-white/80">
              Name
              <input name="name" required maxLength={120} autoComplete="name" className={fieldClass} />
            </label>
            <label className="block text-sm font-medium text-white/80">
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-medium text-white/80">
              Message
              <textarea
                name="message"
                required
                maxLength={5000}
                rows={6}
                className={fieldClass}
              />
            </label>
            <TurnstileField
              siteKey={loaderData.siteKey}
              action="contact"
              resetKey={result && "error" in result ? result.error : "contact"}
              appearance="interaction-only"
            />
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label>
                Company website
                <input name="company_website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
            >
              Send message
            </button>
            <p className="text-sm text-white/50">
              Looking for prices first?{" "}
              <Link to="/pricing" className="text-[#E9D500] underline">
                See pricing
              </Link>
              .
            </p>
          </Form>
        )}
      </div>
    </div>
  );
}
