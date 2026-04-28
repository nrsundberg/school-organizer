import { Button, Input } from "@heroui/react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { toast } from "react-toastify";
import { authClient } from "~/lib/auth-client";

const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 100;

type Props = {
  user: { name: string; email: string };
  logoutHref: string;
};

export default function ProfileForm({ user, logoutHref }: Props) {
  const { t } = useTranslation("profile");

  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const trimmedName = name.trim();
  const nameDirty = trimmedName !== user.name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= MAX_NAME_LENGTH;

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDirty || !nameValid) return;

    setSavingName(true);
    try {
      const result = await authClient.updateUser({ name: trimmedName });
      if (result.error) {
        toast.error(t("nameSection.errorGeneric"));
        return;
      }
      setName(trimmedName);
      toast.success(t("nameSection.success"));
    } catch {
      toast.error(t("nameSection.errorGeneric"));
    } finally {
      setSavingName(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t("passwordSection.errors.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordSection.errors.noMatch"));
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError(t("passwordSection.errors.sameAsCurrent"));
      return;
    }

    setSavingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
      });
      if (result.error) {
        // better-auth returns an error when the current password is wrong.
        setPasswordError(t("passwordSection.errors.currentIncorrect"));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("passwordSection.success"));
    } catch {
      setPasswordError(t("passwordSection.errors.generic"));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-white/65">{t("subtitle")}</p>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#151a1a] p-6">
        <h2 className="text-lg font-semibold">{t("accountSection.title")}</h2>
        <form onSubmit={handleNameSubmit} className="mt-4 flex flex-col gap-3">
          <label className="text-sm text-white/80" htmlFor="profile-email">
            {t("accountSection.emailLabel")}
          </label>
          <Input
            id="profile-email"
            type="email"
            value={user.email}
            readOnly
            disabled
          />
          <p className="-mt-1 text-xs text-white/55">
            {t("accountSection.emailHelp")}
          </p>

          <label className="mt-2 text-sm text-white/80" htmlFor="profile-name">
            {t("accountSection.nameLabel")}
          </label>
          <Input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
          />
          <Button
            type="submit"
            isPending={savingName}
            isDisabled={!nameDirty || !nameValid || savingName}
            className="mt-1 self-start bg-[#E9D500] font-semibold text-[#193B4B]"
          >
            {t("accountSection.save")}
          </Button>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#151a1a] p-6">
        <h2 className="text-lg font-semibold">{t("passwordSection.title")}</h2>
        <p className="mt-1 text-sm text-white/55">
          {t("passwordSection.subtitle")}
        </p>
        <form
          onSubmit={handlePasswordSubmit}
          className="mt-4 flex flex-col gap-3"
        >
          <label className="text-sm text-white/80" htmlFor="profile-current">
            {t("passwordSection.currentLabel")}
          </label>
          <Input
            id="profile-current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <label className="text-sm text-white/80" htmlFor="profile-new">
            {t("passwordSection.newLabel")}
          </label>
          <Input
            id="profile-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          <label className="text-sm text-white/80" htmlFor="profile-confirm">
            {t("passwordSection.confirmLabel")}
          </label>
          <Input
            id="profile-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          {passwordError && (
            <p className="text-sm text-red-400">{passwordError}</p>
          )}
          <Button
            type="submit"
            isPending={savingPassword}
            isDisabled={
              savingPassword ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
            className="mt-1 self-start bg-[#E9D500] font-semibold text-[#193B4B]"
          >
            {t("passwordSection.save")}
          </Button>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#151a1a] p-6">
        <h2 className="text-lg font-semibold">{t("logoutSection.title")}</h2>
        <p className="mt-1 text-sm text-white/55">
          {t("logoutSection.subtitle")}
        </p>
        <Link
          to={logoutHref}
          className="mt-4 inline-block rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
        >
          {t("logoutSection.button")}
        </Link>
      </section>
    </div>
  );
}
