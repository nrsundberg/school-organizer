import { Link } from "react-router";
import type { Route } from "./+types/districts";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPrisma } from "~/db.server";
import { computeCapState } from "~/domain/district/district.server";

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const rows = await db.district.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orgs: true } } },
  });
  const districts = rows.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    schoolCap: d.schoolCap,
    billingPlan: d.billingPlan,
    status: d.status,
    subscriptionStatus: d.subscriptionStatus,
    schoolCount: d._count.orgs,
    capState: computeCapState(d._count.orgs, d.schoolCap),
  }));
  return { districts };
}

export default function PlatformDistricts({
  loaderData,
}: Route.ComponentProps) {
  const { districts } = loaderData;
  const overCap = districts.filter((d) => d.capState.state === "over");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Districts</h2>
      </div>
      {overCap.length ? (
        <div className="rounded border border-red-300 bg-red-500/10 p-3 text-sm text-red-300">
          {overCap.length} district{overCap.length === 1 ? "" : "s"} over their
          school cap.
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Slug</th>
              <th className="px-3 py-2 font-semibold">Schools</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Sub status</th>
            </tr>
          </thead>
          <tbody>
            {districts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-white/50">
                  No districts yet.
                </td>
              </tr>
            ) : null}
            {districts.map((d) => (
              <tr
                key={d.id}
                className={`border-t border-white/10 ${d.capState.state === "over" ? "bg-red-500/5" : ""}`}
              >
                <td className="px-3 py-2">
                  <Link
                    to={`/platform/districts/${d.slug}`}
                    className="font-medium text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">
                  {d.slug}
                </td>
                <td className="px-3 py-2 text-white/80">
                  {d.schoolCount} / {d.schoolCap}
                </td>
                <td className="px-3 py-2 text-white/80">{d.billingPlan}</td>
                <td className="px-3 py-2">{d.status}</td>
                <td className="px-3 py-2 text-white/70">
                  {d.subscriptionStatus ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
