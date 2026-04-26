import type { Route } from "./+types/audit";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { listDistrictAudit } from "~/domain/district/audit.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const entries = await listDistrictAudit(context, districtId, 200);
  return { entries };
}

export default function DistrictAudit({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Audit log</h2>
        <p className="text-sm text-white/50">
          Last 200 events for this district.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Actor</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-white/50"
                >
                  No events yet.
                </td>
              </tr>
            ) : null}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-white/70">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-white/70">
                  {e.actorEmail ?? e.actorUserId ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2 text-white/60">
                  {e.targetType ?? "—"}
                  {e.targetId ? (
                    <>
                      {" · "}
                      <span className="font-mono text-xs">
                        {e.targetId.slice(0, 8)}
                      </span>
                    </>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs text-white/50">
                  {e.details ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
