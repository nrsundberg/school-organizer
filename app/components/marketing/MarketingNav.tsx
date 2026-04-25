import { Link, useRouteLoaderData } from "react-router";
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
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const isAuthed = !!rootData?.user;
  const dashboardUrl = rootData?.dashboardUrl ?? null;
  const showDashboard = isAuthed && !!dashboardUrl;

  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#0f1414]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="inline-flex items-center" aria-label="Pickup Roster home">
          <img src={wordmark} alt="Pickup Roster" className="h-8 w-auto" />
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm font-medium text-white/80">
          <Link to="/pricing" className="transition hover:text-white">
            Pricing
          </Link>
          <Link to="/blog" className="transition hover:text-white">
            Blog
          </Link>
          <Link to="/guides" className="transition hover:text-white">
            Guides
          </Link>
          <Link to="/faqs" className="transition hover:text-white">
            FAQs
          </Link>
          {showDashboard ? (
            <a
              href={dashboardUrl!}
              className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-[#193B4B] transition hover:bg-[#f5e047]"
            >
              Dashboard
            </a>
          ) : (
            <>
              <Link to="/login" className="transition hover:text-white">
                Log in
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-[#193B4B] transition hover:bg-[#f5e047]"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
