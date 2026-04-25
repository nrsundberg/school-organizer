import { Button, Input } from "@heroui/react";
import { redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { hashPassword } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { Route } from "./+types/set-password";
import { useState } from "react";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string } }) {
  return [{ title: data?.metaTitle ?? "Set password — Pickup Roster" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw redirect("/login");
  if (!user.mustChangePassword) throw redirect("/");
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return {
    email: user.email,
    metaTitle: t("setPasswordRequired.metaTitle"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw redirect("/login");

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");

  const formData = await request.formData();
  const newPassword = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!newPassword || newPassword.length < 8) {
    return { error: t("setPasswordRequired.errors.passwordTooShort") };
  }
  if (newPassword !== confirm) {
    return { error: t("setPasswordRequired.errors.passwordsDoNotMatch") };
  }

  const prisma = getPrisma(context);
  const hashed = await hashPassword(newPassword);

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!account) return { error: t("setPasswordRequired.errors.noCredentialAccount") };

  await prisma.account.update({
    where: { id: account.id },
    data: { password: hashed },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false },
  });

  throw redirect("/");
}

export default function SetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const { email } = loaderData;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#212525]">
      <p className="text-2xl font-bold text-white mb-1">{t("setPasswordRequired.brand")}</p>
      <p className="text-lg font-semibold text-white mb-2">{t("setPasswordRequired.welcome")}</p>
      <p className="text-sm text-white/60 mb-6">{t("setPasswordRequired.subtitle")}</p>

      <form method="post" className="flex flex-col gap-3 w-full max-w-sm px-4">
        <p className="text-white/50 text-sm text-center">{email}</p>
        <label className="text-sm text-gray-400" htmlFor="set-password-new">{t("setPasswordRequired.newLabel")}</label>
        <Input
          id="set-password-new"
          type="password"
          name="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          placeholder={t("setPasswordRequired.newPlaceholder")}
        />
        <label className="text-sm text-gray-400" htmlFor="set-password-confirm">{t("setPasswordRequired.confirmLabel")}</label>
        <Input
          id="set-password-confirm"
          type="password"
          name="confirm"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {actionData?.error && (
          <p className="text-red-400 text-sm text-center">{actionData.error}</p>
        )}
        <Button type="submit" variant="primary">
          {t("setPasswordRequired.submit")}
        </Button>
      </form>
    </div>
  );
}
