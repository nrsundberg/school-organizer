import { NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { DEFAULT_SITE_NAME } from "~/lib/site";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    isActive ? "bg-[#E9D500]/15 text-[#E9D500]" : "text-white/70 hover:bg-white/5 hover:text-white",
  ].join(" ");

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  return null;
}

export default function PlatformLayout() {
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Platform</p>
        <h1 className="text-xl font-bold">{`${DEFAULT_SITE_NAME} — internal`}</h1>
        <nav className="mt-4 flex flex-wrap gap-1 border-t border-white/10 pt-3">
          <NavLink to="/platform" end className={navLinkClass}>
            Orgs
          </NavLink>
          <NavLink to="/platform/signups" className={navLinkClass}>
            Signups
          </NavLink>
          <NavLink to="/platform/sessions" className={navLinkClass}>
            Sessions
          </NavLink>
          <NavLink to="/platform/webhooks" className={navLinkClass}>
            Webhooks
          </NavLink>
          <NavLink to="/platform/audit" className={navLinkClass}>
            Audit
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
