import { Link } from "react-router";
import type { Route } from "./+types/index";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import {
  computeCapState,
  getDistrictById,
} from "~/domain/district/district.server";
import {
  getDistrictRollup,
  getSchoolCountsForDistrict,
} from "~/domain/district/district-scope.server";
import { PLAN_LIMITS, warnThreshold } from "~/lib/plan-limits";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schools, rollup] = await Promise.all([
    getDistrictById(context, districtId),
    getSchoolCountsForDistrict(context, districtId),
    getDistrictRollup(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  return {
    district,
    schools,
    rollup,
    cap: computeCapState(schools.length, district.schoolCap),
  };
}

export default function DistrictDashboard({
  loaderData,
}: Route.ComponentProps) {
  const { district, schools, rollup, cap } = loaderData;
  const campusCaps = PLAN_LIMITS.CAMPUS;
  const studentsWarn = warnThreshold(campusCaps.students);
  const familiesWarn = warnThreshold(campusCaps.families);
  const classroomsWarn = warnThreshold(campusCaps.classrooms);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{district.name}</h2>
          <p className="text-xs text-white/50">
            Plan: {district.billingPlan} · Status: {district.status}
          </p>
        </div>
        <div className="text-sm text-white/70">
          {cap.count} of {cap.cap} schools
        </div>
        <Link
          to="/district/billing"
          className="ml-auto rounded-lg bg-[#E9D500] px-3 py-1.5 text-xs font-semibold text-[#193B4B] hover:bg-[#f5e047]"
        >
          Manage billing
        </Link>
      </div>

      {cap.state === "over" ? (
        <div className="rounded border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-200">
          You&rsquo;re {cap.over} over your contracted school cap. Your
          account manager will be in touch.
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 font-medium">District totals</h3>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-white/50">Students</div>
            <div className="text-xl">{rollup.totalStudents}</div>
          </div>
          <div>
            <div className="text-white/50">Families</div>
            <div className="text-xl">{rollup.totalFamilies}</div>
          </div>
          <div>
            <div className="text-white/50">Classrooms</div>
            <div className="text-xl">{rollup.totalClassrooms}</div>
          </div>
          <div>
            <div className="text-white/50">Calls (7d)</div>
            <div className="text-xl">{rollup.callsLast7d}</div>
          </div>
          <div>
            <div className="text-white/50">Calls (30d)</div>
            <div className="text-xl">{rollup.callsLast30d}</div>
          </div>
          <div>
            <div className="text-white/50">Active schools (30d)</div>
            <div className="text-xl">{rollup.activeSchools}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 font-medium">Schools</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="px-2 py-1 font-normal">School</th>
                <th className="px-2 py-1 font-normal">Status</th>
                <th className="px-2 py-1 font-normal">Students</th>
                <th className="px-2 py-1 font-normal">Families</th>
                <th className="px-2 py-1 font-normal">Classrooms</th>
                <th className="px-2 py-1 font-normal">Last activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schools.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-white/50">
                    No schools yet.{" "}
                    <Link
                      to="/district/schools/new"
                      className="text-[#E9D500] underline"
                    >
                      Add your first school
                    </Link>
                    .
                  </td>
                </tr>
              ) : null}
              {schools.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-medium">{s.name}</td>
                  <td className="px-2 py-1.5 text-white/70">{s.status}</td>
                  <td
                    className={`px-2 py-1.5 ${s.students >= studentsWarn ? "font-medium text-amber-300" : "text-white/70"}`}
                  >
                    {s.students} / {campusCaps.students}
                  </td>
                  <td
                    className={`px-2 py-1.5 ${s.families >= familiesWarn ? "font-medium text-amber-300" : "text-white/70"}`}
                  >
                    {s.families} / {campusCaps.families}
                  </td>
                  <td
                    className={`px-2 py-1.5 ${s.classrooms >= classroomsWarn ? "font-medium text-amber-300" : "text-white/70"}`}
                  >
                    {s.classrooms} / {campusCaps.classrooms}
                  </td>
                  <td className="px-2 py-1.5 text-white/70">
                    {s.lastCallAt
                      ? new Date(s.lastCallAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">
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
      </div>
    </section>
  );
}
