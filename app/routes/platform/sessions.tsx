import { Form } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/sessions";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Sessions" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);

  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? "";
  const since = url.searchParams.get("since") ?? "";

  const where: Record<string, unknown> = {};
  if (email.trim()) {
    where.user = { email: { contains: email.trim() } };
  }
  if (since.trim()) {
    const sinceDate = new Date(since.trim());
    if (!isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  const sessions = await db.session.findMany({
    where,
    take: 100,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true, orgId: true } },
    },
  });
  return { sessions, email, since };
}

export default function PlatformSessions({ loaderData }: Route.ComponentProps) {
  const { sessions, email, since } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Sessions</h1>
        <p className="mt-1 text-sm text-white/60">Last 100 sessions (filtered) by creation time.</p>
      </div>

      {/* Filter form */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Email contains</span>
          <input
            type="search"
            name="email"
            defaultValue={email}
            placeholder="user@example.com"
            className="min-w-[200px] rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Created since</span>
          <input
            type="date"
            name="since"
            defaultValue={since}
            className="rounded-lg border border-white/15 bg-[#0f1414] px-3 py-2 text-white focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#E9D500]/20 px-4 py-2 text-sm font-medium text-[#E9D500] hover:bg-[#E9D500]/30"
        >
          Filter
        </button>
        <a
          href="/platform/sessions"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:text-white"
        >
          Reset
        </a>
      </Form>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">User email</th>
              <th className="px-3 py-2 font-semibold">Org ID</th>
              <th className="px-3 py-2 font-semibold">Impersonated by</th>
              <th className="px-3 py-2 font-semibold">Expires</th>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">IP</th>
              <th className="px-3 py-2 font-semibold">User agent</th>
              <th className="px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-white/10 align-top">
                <td className="px-3 py-2 font-mono text-xs">{s.user.email}</td>
                <td className="px-3 py-2 font-mono text-xs text-white/70">{s.user.orgId ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-amber-400">
                  {s.impersonatedBy ?? "—"}
                </td>
                <td className="px-3 py-2 text-white/70">
                  {s.expiresAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2 text-white/70">
                  {s.createdAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/70">{s.ipAddress ?? "—"}</td>
                <td className="px-3 py-2 max-w-[240px] break-all text-xs text-white/60">
                  {s.userAgent ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <Form
                    method="post"
                    action="/platform/sessions/revoke"
                    onSubmit={(e) => {
                      if (!confirm("Revoke this session?")) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="sessionId" value={s.id} />
                    <input type="hidden" name="returnEmail" value={email} />
                    <input type="hidden" name="returnSince" value={since} />
                    <button
                      type="submit"
                      className="rounded bg-red-500/20 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30"
                    >
                      Revoke
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
