import { Button, Input } from "@heroui/react";
import { Link, redirect, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
// @ts-expect-error - route types not yet generated
import type { Route } from "./+types/set-password";
import { useState } from "react";
import { signIn, authClient } from "~/lib/auth-client";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Set password — Pickup Roster" },
    { name: "description", content: data?.metaDescription ?? "Set your password for your school car line" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return {
    metaTitle: t("setPassword.metaTitle"),
    metaDescription: t("setPassword.metaDescription"),
  };
}

export default function SetPassword() {
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const emailFromParams = searchParams.get("email") ?? "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(t("setPassword.errors.passwordsDoNotMatch"));
      return;
    }

    if (newPassword.length < 8) {
      setError(t("setPassword.errors.passwordTooShort"));
      return;
    }

    setLoading(true);

    try {
      // Sign in with the temporary password first
      const signInResult = await signIn.email({
        email: emailFromParams,
        password: currentPassword,
      });

      if (signInResult.error) {
        setError(t("setPassword.errors.tempIncorrect"));
        setLoading(false);
        return;
      }

      // Now change to the new password
      const changeResult = await authClient.changePassword({
        currentPassword,
        newPassword,
      });

      if (changeResult.error) {
        setError(t("setPassword.errors.setFailed"));
        setLoading(false);
        return;
      }

      window.location.href = "/";
    } catch {
      setError(t("setPassword.errors.generic"));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">{t("setPassword.title")}</h1>
          <p className="mt-2 text-sm text-white/65">
            {t("setPassword.subtitle")}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <label className="text-sm text-white/80" htmlFor="set-password-current">{t("setPassword.currentLabel")}</label>
            <Input
              id="set-password-current"
              type="password"
              placeholder={t("setPassword.currentPlaceholder")}
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <label className="text-sm text-white/80" htmlFor="set-password-new">{t("setPassword.newLabel")}</label>
            <Input
              id="set-password-new"
              type="password"
              placeholder={t("setPassword.newPlaceholder")}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <label className="text-sm text-white/80" htmlFor="set-password-confirm">{t("setPassword.confirmLabel")}</label>
            <Input
              id="set-password-confirm"
              type="password"
              placeholder={t("setPassword.confirmPlaceholder")}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error && (
              <p className="text-center text-sm text-red-400">{error}</p>
            )}
            <Button
              type="submit"
              isPending={loading}
              variant="primary"
              className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
            >
              {t("setPassword.submit")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-white/55">
            <Link to="/login" className="font-medium text-[#E9D500] hover:underline">
              {t("setPassword.backToLogin")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
