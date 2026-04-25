import { Button, Input } from "@heroui/react";
import { data, Form, Link } from "react-router";
import { redirectWithSuccess } from "remix-toast";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/reset-password";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  consumePasswordResetToken,
  lookupPasswordResetToken,
} from "~/domain/auth/password-reset.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string } }) {
  return [{ title: data?.metaTitle ?? "Reset password — Pickup Roster" }];
}

// Must match the signup form's rule in app/routes/auth/signup.tsx (min 8).
// Keep in sync if that rule ever tightens.
const MIN_PASSWORD_LENGTH = 8;

const actionSchema = zfd.formData({
  token: zfd.text(z.string().min(1)),
  password: zfd.text(z.string().min(MIN_PASSWORD_LENGTH)),
  confirm: zfd.text(z.string().min(MIN_PASSWORD_LENGTH)),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim() ?? "";
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  const metaTitle = t("resetPassword.metaTitle");
  if (!rawToken) {
    return { state: "invalid" as const, token: "", metaTitle };
  }
  const lookup = await lookupPasswordResetToken(context, rawToken);
  if (!lookup.ok) {
    return { state: "invalid" as const, token: "", reason: lookup.reason, metaTitle };
  }
  return { state: "valid" as const, token: rawToken, metaTitle };
}

export async function action({ request, context }: Route.ActionArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");

  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "reset-password:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { error: t("resetPassword.errors.rateLimited") },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const formData = await request.formData();
  const parsed = actionSchema.safeParse(formData);
  if (!parsed.success) {
    return data(
      {
        error:
          parsed.error.issues.find((i) => i.path[0] === "password")
            ? t("resetPassword.errors.passwordMin", { min: MIN_PASSWORD_LENGTH })
            : t("resetPassword.errors.fillBoth"),
      },
      { status: 400 },
    );
  }
  const { token, password, confirm } = parsed.data;

  if (password !== confirm) {
    return data({ error: t("resetPassword.errors.passwordsDoNotMatch") }, { status: 400 });
  }

  const result = await consumePasswordResetToken(context, {
    rawToken: token,
    newPassword: password,
  });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? t("resetPassword.errors.expired")
        : result.reason === "used"
          ? t("resetPassword.errors.used")
          : result.reason === "org-disabled"
            ? t("resetPassword.errors.orgDisabled")
            : t("resetPassword.errors.invalid");
    return data({ error: message }, { status: 400 });
  }

  throw await redirectWithSuccess("/login", {
    message: t("resetPassword.errors.successToast"),
  });
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (loaderData.state === "invalid") {
    return (
      <div className="min-h-screen bg-[#0f1414] text-white">
        <MarketingNav />
        <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
          <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
            <h1 className="text-2xl font-bold">{t("resetPassword.invalid.title")}</h1>
            <p className="mt-2 text-sm text-white/65">
              {t("resetPassword.invalid.subtitle")}
            </p>
            <div className="mt-6">
              <Link
                to="/forgot-password"
                className="inline-flex items-center rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:brightness-95"
              >
                {t("resetPassword.invalid.requestNew")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">{t("resetPassword.valid.title")}</h1>
          <p className="mt-2 text-sm text-white/65">
            {t("resetPassword.valid.subtitle", { min: MIN_PASSWORD_LENGTH })}
          </p>

          <Form method="post" className="mt-6 flex w-full flex-col gap-3">
            <input type="hidden" name="token" value={loaderData.token} />
            <label className="text-sm text-white/80" htmlFor="password">
              {t("resetPassword.valid.newLabel")}
            </label>
            <Input
              id="password"
              type="password"
              name="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={t("resetPassword.valid.newPlaceholder", { min: MIN_PASSWORD_LENGTH })}
            />
            <label className="text-sm text-white/80" htmlFor="confirm">
              {t("resetPassword.valid.confirmLabel")}
            </label>
            <Input
              id="confirm"
              type="password"
              name="confirm"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {actionData?.error && (
              <p className="text-center text-sm text-red-400">{actionData.error}</p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
            >
              {t("resetPassword.valid.submit")}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
