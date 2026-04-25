import { Button, Input } from "@heroui/react";
import { data, Form, Link } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/forgot-password";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getPrisma } from "~/db.server";
import { createPasswordResetToken } from "~/domain/auth/password-reset.server";
import { enqueueEmail } from "~/domain/email/queue.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import { marketingOriginFromRequest } from "~/domain/utils/host.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Forgot password — Pickup Roster" },
    {
      name: "description",
      content: data?.metaDescription ?? "Start a password reset for your PickupRoster account.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return {
    metaTitle: t("forgotPassword.metaTitle"),
    metaDescription: t("forgotPassword.metaDescription"),
  };
}

const schema = zfd.formData({
  email: zfd.text(z.string().trim().toLowerCase().email()),
});

function firstNameFromUserName(name: string | null | undefined): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

function resetUrlFor(request: Request, context: any, rawToken: string): string {
  // Reset links are sent over email; recipients may click from a phone
  // that doesn't know which tenant subdomain they use. Anchor on the
  // marketing origin (apex) so the link always resolves.
  const base = marketingOriginFromRequest(request, context).replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export async function action({ request, context }: Route.ActionArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");

  // Rate limit by IP using the existing auth limiter. Forgotten-password is
  // a cheap user-enum vector if unmetered.
  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "forgot-password:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { ok: false as const, error: t("forgotPassword.errors.rateLimited") },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const formData = await request.formData();
  const parsed = schema.safeParse(formData);
  if (!parsed.success) {
    // Don't leak precisely which field failed — generic error is fine.
    return data({ ok: true as const }, { status: 200 });
  }
  const { email } = parsed.data;

  // Cast to any for the same reason as password-reset.server.ts: the
  // generated Prisma client doesn't surface the new `passwordResetEnabled`
  // column on Org until `prisma generate` runs in the build pipeline.
  const db = getPrisma(context) as any;
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      orgId: true,
      org: { select: { passwordResetEnabled: true } },
    },
  });

  // User enumeration defence: we ALWAYS return a generic success response.
  // Only enqueue the email if the user exists AND their org allows password
  // reset. Anything else → no-op, same response.
  const orgAllowsReset = user?.org ? user.org.passwordResetEnabled !== false : true;
  if (user && orgAllowsReset) {
    const userAgent = request.headers.get("user-agent");
    const { rawToken } = await createPasswordResetToken(context, {
      userId: user.id,
      requestIp: clientIp,
      requestUserAgent: userAgent,
    });
    const resetUrl = resetUrlFor(request, context, rawToken);
    await enqueueEmail(context, {
      kind: "password_reset",
      to: user.email,
      firstName: firstNameFromUserName(user.name),
      resetUrl,
      expiryMinutes: 60,
      requestIp: clientIp,
      locale: user.locale ?? locale,
    });
  }

  return data({ ok: true as const });
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const submitted = actionData?.ok === true;
  const rlError = actionData?.ok === false ? actionData.error : null;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">{t("forgotPassword.title")}</h1>
          <p className="mt-2 text-sm text-white/65">
            {t("forgotPassword.subtitle")}
          </p>

          {submitted ? (
            <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <p className="font-medium">{t("forgotPassword.submitted.headline")}</p>
              <p className="mt-1 text-emerald-100/80">
                {t("forgotPassword.submitted.body")}
              </p>
              <p className="mt-3 text-xs text-emerald-100/60">
                {t("forgotPassword.submitted.ssoNote")}
              </p>
            </div>
          ) : (
            <Form method="post" className="mt-6 flex w-full flex-col gap-3">
              <label className="text-sm text-white/80" htmlFor="email">
                {t("forgotPassword.emailLabel")}
              </label>
              <Input
                id="email"
                type="email"
                name="email"
                placeholder={t("forgotPassword.emailPlaceholder")}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              {rlError && (
                <p className="text-center text-sm text-red-400">{rlError}</p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
              >
                {t("forgotPassword.submit")}
              </Button>
            </Form>
          )}

          <p className="mt-6 text-center text-sm text-white/55">
            {t("forgotPassword.rememberedIt")}{" "}
            <Link to="/login" className="font-medium text-[#E9D500] hover:underline">
              {t("forgotPassword.backToLogin")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
