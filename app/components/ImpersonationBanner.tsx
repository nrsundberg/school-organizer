import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "~/lib/auth-client";

export function ImpersonationBanner({ userName }: { userName: string }) {
  const { t } = useTranslation("common");
  const [isLoading, setIsLoading] = useState(false);

  async function handleStop() {
    setIsLoading(true);
    const { error } = await authClient.admin.stopImpersonating();
    if (error) {
      await authClient.signOut();
      window.location.href = "/login";
      return;
    }
    window.location.href = "/admin/users";
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-red-600 px-4 py-2 text-white">
      <span className="text-sm font-medium">
        {t("impersonation.label")} <strong>{userName}</strong>
      </span>
      <button
        onClick={handleStop}
        disabled={isLoading}
        className="rounded-md bg-white/20 px-3 py-1 text-sm font-medium transition-colors hover:bg-white/30 disabled:opacity-50"
      >
        {isLoading ? t("impersonation.stopping") : t("impersonation.stop")}
      </button>
    </div>
  );
}
