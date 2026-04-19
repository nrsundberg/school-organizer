import { Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  return null;
}

export default function PlatformLayout() {
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Platform</p>
        <h1 className="text-xl font-bold">School Organizer — internal</h1>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
