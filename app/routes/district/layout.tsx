import { NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictById } from "~/domain/district/district.server";
import { DEFAULT_SITE_NAME } from "~/lib/site";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-[#E9D500]/15 text-[#E9D500]"
      : "text-white/70 hover:bg-white/5 hover:text-white",
  ].join(" ");

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  return { district };
}

export default function DistrictLayout({ loaderData }: Route.ComponentProps) {
  const { district } = loaderData;
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          District portal
        </p>
        <div className="flex items-center gap-3">
          {district.logoUrl ? (
            <img
              src={district.logoUrl}
              alt=""
              className="h-8 w-8 rounded"
            />
          ) : null}
          <h1 className="text-xl font-bold">{district.name}</h1>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">
            {district.status}
          </span>
          <span className="ml-auto text-xs text-white/40">
            {DEFAULT_SITE_NAME}
          </span>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1 border-t border-white/10 pt-3">
          <NavLink to="/district" end className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/district/schools" className={navLinkClass}>
            Schools
          </NavLink>
          <NavLink to="/district/admins" className={navLinkClass}>
            Admins
          </NavLink>
          <NavLink to="/district/billing" className={navLinkClass}>
            Billing
          </NavLink>
          <NavLink to="/district/audit" className={navLinkClass}>
            Audit log
          </NavLink>
          <NavLink
            to="/district/profile"
            className={(args) => `${navLinkClass(args)} ml-auto`}
          >
            Profile
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
