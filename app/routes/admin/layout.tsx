import { useState } from "react";
import { isRouteErrorResponse, Outlet, useRouteError, useRouteLoaderData } from "react-router";
import { Menu, X, ShieldAlert, LogIn } from "lucide-react";
import type { Route } from "./+types/layout";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import AdminSidebar from "~/components/admin/AdminSidebar";
import Header from "~/components/Header";
import logo from "/favicon.ico?url";

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  return {};
}

export function ErrorBoundary() {
  const error = useRouteError();

  const is401 =
    isRouteErrorResponse(error) && error.status === 401;
  const is403 =
    isRouteErrorResponse(error) && error.status === 403;

  if (is401 || is403) {
    return (
      <div className="min-h-screen bg-[#212525] text-white flex flex-col">
        <div className="h-10 w-full bg-blue-300 flex items-center justify-center flex-shrink-0 relative">
          <a href="/" className="text-black font-bold inline-flex items-center">
            <img src={logo} alt="school logo" height={40} width={40} />
            School Organizer — Car line
          </a>
          <a
            href="/login"
            className="border border-black p-1 rounded-lg absolute right-2 text-black text-sm"
          >
            Login
          </a>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
          <div className="rounded-full bg-blue-300/10 p-5">
            {is401 ? (
              <LogIn className="w-10 h-10 text-blue-300" />
            ) : (
              <ShieldAlert className="w-10 h-10 text-blue-300" />
            )}
          </div>
          <h1 className="text-2xl font-semibold">
            {is401 ? "Login Required" : "Access Denied"}
          </h1>
          <p className="text-white/60 text-center max-w-sm">
            {is401
              ? "You need to be logged in to access the admin panel."
              : "Your account doesn't have permission to access the admin panel."}
          </p>
          <div className="flex gap-3 mt-2">
            {is401 && (
              <a
                href="/login"
                className="bg-blue-300 text-black font-semibold px-4 py-2 rounded-lg hover:bg-blue-400 transition-colors"
              >
                Log In
              </a>
            )}
            <a
              href="/"
              className="border border-white/20 text-white px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              Go Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Fall through to root error boundary for unexpected errors
  throw error;
}

export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rootData = useRouteLoaderData("root") as
    | { branding?: { orgName?: string; primaryColor?: string; logoUrl?: string | null } }
    | undefined;

  return (
    <div className="flex flex-col min-h-screen bg-[#212525] text-white">
      <Header user={true} branding={rootData?.branding} />
      <div className="flex flex-1">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen bg-[#1a1f1f] border-r border-white/10 flex-shrink-0">
        <AdminSidebar />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile hamburger header */}
        <div className="md:hidden flex items-center h-12 bg-[#1a1f1f] border-b border-white/10 px-3 flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/60 hover:text-white mr-2 p-1"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-white tracking-wide">Admin Panel</span>
        </div>

        {/* Mobile drawer overlay */}
        {drawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-[60] flex"
            onClick={() => setDrawerOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-64 h-full bg-[#1a1f1f] border-r border-white/10 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-sm font-semibold">Admin Panel</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="text-white/60 hover:text-white p-1"
                  aria-label="Close navigation"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <AdminSidebar onLinkClick={() => setDrawerOpen(false)} />
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
