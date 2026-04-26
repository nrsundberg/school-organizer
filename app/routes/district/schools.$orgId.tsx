import { Form } from "react-router";
import type { Route } from "./+types/schools.$orgId";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getDistrictDb } from "~/domain/district/district-scope.server";

export async function loader({ context, params }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const db = getDistrictDb(context);
  // Explicit district filter — district admins are off the tenant-extension,
  // so every cross-school read must include `districtId`.
  const org = await db.org.findFirst({
    where: { id: params.orgId, districtId },
  });
  if (!org) throw new Response("Not found", { status: 404 });
  const [students, families, classrooms, lastCall] = await Promise.all([
    db.student.count({ where: { orgId: org.id } }),
    db.household.count({ where: { orgId: org.id } }),
    db.space.count({ where: { orgId: org.id } }),
    db.callEvent.findFirst({
      where: { orgId: org.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    org,
    students,
    families,
    classrooms,
    lastCallAt: lastCall?.createdAt ?? null,
  };
}

export default function SchoolDetail({ loaderData }: Route.ComponentProps) {
  const { org, students, families, classrooms, lastCallAt } = loaderData;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{org.name}</h2>
        <p className="text-sm text-white/50">
          Slug: <span className="font-mono">{org.slug}</span> · Status:{" "}
          {org.status}
        </p>
      </div>
      <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
        <dt className="text-white/50">Students</dt>
        <dd>{students}</dd>
        <dt className="text-white/50">Families</dt>
        <dd>{families}</dd>
        <dt className="text-white/50">Classrooms</dt>
        <dd>{classrooms}</dd>
        <dt className="text-white/50">Last activity</dt>
        <dd>{lastCallAt ? new Date(lastCallAt).toLocaleString() : "—"}</dd>
      </dl>
      <div className="flex gap-3">
        <Form
          method="post"
          action={`/district/schools/${org.id}/impersonate`}
        >
          <button
            type="submit"
            className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
          >
            Open as admin
          </button>
        </Form>
      </div>
    </section>
  );
}
