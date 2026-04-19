import { Link } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/signups";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Signups" }];

function parseDays(searchParams: URLSearchParams): number {
  const raw = searchParams.get("days");
  const n = raw ? Number.parseInt(raw, 10) : 30;
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(n, 365);
}

export async function loader({ context, request }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const days = parseDays(new URL(request.url).searchParams);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const orgs = await db.org.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      users: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { email: true },
      },
    },
  });

  return { orgs, days };
}

export default function PlatformSignups({ loaderData }: Route.ComponentProps) {
  const { orgs, days } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Recent signups</h1>
        <p className="mt-1 text-sm text-white/60">
          Organizations created in the last {days} days. Use{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">?days=</code> to change the window (1–365).
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Slug</th>
              <th className="px-3 py-2 font-semibold">First user email</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-white/70">
                  {org.createdAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/platform/orgs/${org.id}`}
                    className="font-medium text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    {org.name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">{org.slug}</td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">
                  {org.users[0]?.email ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {orgs.length === 0 ? (
        <p className="text-sm text-white/50">No organizations in this window.</p>
      ) : null}
    </div>
  );
}
