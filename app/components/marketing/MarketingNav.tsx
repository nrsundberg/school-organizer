import { Link, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import wordmark from "/logo-wordmark.svg?url";

/**
 * Marketing header. When the user is logged in and has an org, swap the
 * "Log in" link for a "Dashboard" button pointing at their tenant subdomain
 * (populated from the root loader's `dashboardUrl`). Non-authed users still
 * see the standard "Log in" + "Sign up" pair.
 */
type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
  dashboardUrl?: string | null;
};

export function MarketingNav() {
  const { t } = useTranslation("common");
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const isAuthed = !!rootData?.user;
  const dashboardUrl = rootData?.dashboardUrl ?? null;
  const showDashboard = isAuthed && !!dashboardUrl;

  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#0f1414]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link
          to="/"
          className="inline-flex items-center"
          aria-label={t("marketingNav.homeAriaLabel")}
        >
          <img src={wordmark} alt={t("marketingNav.wordmarkAlt")} className="h-8 w-auto" />
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm font-medium text-white/80">
          <Link to="/pricing" className="transition hover:text-white">
            {t("marketingNav.pricing")}
          </Link>
          <Link to="/blog" className="transition hover:text-white">
            {t("marketingNav.blog")}
          </Link>
          <Link to="/guides" className="transition hover:text-white">
            {t("marketingNav.guides")}
          </Link>
          <Link to="/faqs" className="transition hover:text-white">
            {t("marketingNav.faqs")}
          </Link>
          {showDashboard ? (
            <a
              href={dashboardUrl!}
              className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-[#193B4B] transition hover:bg-[#f5e047]"
            >
              {t("marketingNav.dashboard")}
            </a>
          ) : (
            <>
              <Link to="/login" className="transition hover:text-white">
                {t("marketingNav.login")}
              </Link>
              <Link
                to="/pricing"
                className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-[#193B4B] transition hover:bg-[#f5e047]"
              >
                {t("marketingNav.signup")}
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
