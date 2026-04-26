import { Link } from "react-router";
import type { Route } from "./+types/schools";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import {
  computeCapState,
  getDistrictById,
} from "~/domain/district/district.server";
import { getSchoolCountsForDistrict } from "~/domain/district/district-scope.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schools] = await Promise.all([
    getDistrictById(context, districtId),
    getSchoolCountsForDistrict(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  const cap = computeCapState(schools.length, district.schoolCap);
  return { schools, cap };
}

export default function DistrictSchools({ loaderData }: Route.ComponentProps) {
  const { schools, cap } = loaderData;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Schools ({cap.count} of {cap.cap})
        </h2>
        <Link
          to="/district/schools/new"
          className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
        >
          + Add school
        </Link>
      </div>
      {cap.state === "over" ? (
        <div className="rounded border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-200">
          You&rsquo;re {cap.over} over your contracted school cap. Your
          account manager will be in touch.
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">School</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Students</th>
              <th className="px-3 py-2 font-semibold">Families</th>
              <th className="px-3 py-2 font-semibold">Classrooms</th>
              <th className="px-3 py-2 font-semibold">Last activity</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {schools.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-white/50"
                >
                  No schools yet. Add your first school to get started.
                </td>
              </tr>
            ) : null}
            {schools.map((s) => (
              <tr key={s.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2 text-white/70">{s.status}</td>
                <td className="px-3 py-2 text-white/70">{s.students}</td>
                <td className="px-3 py-2 text-white/70">{s.families}</td>
                <td className="px-3 py-2 text-white/70">{s.classrooms}</td>
                <td className="px-3 py-2 text-white/70">
                  {s.lastCallAt
                    ? new Date(s.lastCallAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/district/schools/${s.id}`}
                    className="text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
