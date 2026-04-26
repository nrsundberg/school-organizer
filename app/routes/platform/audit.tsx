import { Form } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/audit";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Audit Log" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId") ?? "";
  const actor = url.searchParams.get("actor") ?? "";
  const action = url.searchParams.get("action") ?? "";
  const since = url.searchParams.get("since") ?? "";

  const where: Record<string, unknown> = {};
  if (orgId.trim()) {
    where.orgId = orgId.trim();
  }
  if (actor.trim()) {
    where.actorUserId = { contains: actor.trim() };
  }
  if (action.trim()) {
    where.action = { contains: action.trim() };
  }
  if (since.trim()) {
    const sinceDate = new Date(since.trim());
    if (!isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  const [logs, orgs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).orgAuditLog.findMany({
      where,
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        org: { select: { name: true, slug: true } },
      },
    }),
    db.org.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Resolve actor emails: collect unique actorUserIds then batch-fetch
  const actorIds: string[] = [
    ...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (logs as any[]).map((l: any) => l.actorUserId).filter(Boolean) as string[],
    ),
  ];
  const actorUsers =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
  const actorEmailMap = Object.fromEntries(actorUsers.map((u) => [u.id, u.email]));

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logs: (logs as any[]).map((l: any) => ({
      id: l.id as string,
      orgId: l.orgId as string,
      orgName: (l.org?.name ?? l.orgId) as string,
      orgSlug: (l.org?.slug ?? "") as string,
      actorUserId: l.actorUserId as string | null,
      actorEmail: l.actorUserId ? (actorEmailMap[l.actorUserId] ?? l.actorUserId) : null,
      action: l.action as string,
      payload: l.payload,
      createdAt: (l.createdAt as Date).toISOString(),
    })),
    orgs,
    orgId,
    actor,
    action,
    since,
  };
}

export default function PlatformAudit({ loaderData }: Route.ComponentProps) {
  const { logs, orgs, orgId, actor, action, since } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Audit Log</h1>
        <p className="mt-1 text-sm text-white/60">Last 200 audit entries (filtered), newest first.</p>
      </div>

      {/* Filter form */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Org</span>
          <select
            name="orgId"
            defaultValue={orgId}
            className="app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          >
            <option value="">All orgs</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Actor (user ID or email)</span>
          <input
            type="search"
            name="actor"
            defaultValue={actor}
            placeholder="user ID substring"
            className="min-w-[180px] app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Action contains</span>
          <input
            type="search"
            name="action"
            defaultValue={action}
            placeholder="comp.set"
            className="min-w-[140px] app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Since</span>
          <input
            type="date"
            name="since"
            defaultValue={since}
            className="app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#E9D500]/20 px-4 py-2 text-sm font-medium text-[#E9D500] hover:bg-[#E9D500]/30"
        >
          Filter
        </button>
        <a
          href="/platform/audit"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:text-white"
        >
          Reset
        </a>
      </Form>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Timestamp</th>
              <th className="px-3 py-2 font-semibold">Org</th>
              <th className="px-3 py-2 font-semibold">Actor</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-white/10 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-white/70 text-xs">
                  {log.createdAt.replace("T", " ").slice(0, 19)}Z
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-medium">{log.orgName}</span>
                  {log.orgSlug && (
                    <span className="ml-1 text-white/40">({log.orgSlug})</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/70">
                  {log.actorEmail ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-3 py-2 text-xs text-white/60">
                  {log.payload ? (
                    <details>
                      <summary className="cursor-pointer text-[#E9D500]/80 hover:text-[#E9D500]">
                        {JSON.stringify(log.payload).slice(0, 60)}
                        {JSON.stringify(log.payload).length > 60 ? "…" : ""}
                      </summary>
                      <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-white/5 p-2 text-[10px]">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-white/40">
                  No audit entries match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
