import { getPrisma } from "~/db.server";
import type { Route } from "./+types/sessions";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Sessions" }];

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const sessions = await db.session.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true, orgId: true } },
    },
  });
  return { sessions };
}

export default function PlatformSessions({ loaderData }: Route.ComponentProps) {
  const { sessions } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Sessions</h1>
        <p className="mt-1 text-sm text-white/60">Last 100 sessions by creation time.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">User email</th>
              <th className="px-3 py-2 font-semibold">Org ID</th>
              <th className="px-3 py-2 font-semibold">Expires</th>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">IP</th>
              <th className="px-3 py-2 font-semibold">User agent</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-white/10 align-top">
                <td className="px-3 py-2 font-mono text-xs">{s.user.email}</td>
                <td className="px-3 py-2 font-mono text-xs text-white/70">{s.user.orgId ?? "—"}</td>
                <td className="px-3 py-2 text-white/70">
                  {s.expiresAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2 text-white/70">
                  {s.createdAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/70">{s.ipAddress ?? "—"}</td>
                <td className="px-3 py-2 max-w-[280px] break-all text-xs text-white/60">
                  {s.userAgent ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
