import { useEffect } from "react";
import type { Route } from "./+types/print.homeroom.$teacherId";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { requireRole } from "~/sessions.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireRole(context, "ADMIN");
  const prisma = getTenantPrisma(context);
  const teacherId = parseInt(params.teacherId ?? "", 10);
  if (isNaN(teacherId)) {
    throw new Response("Invalid homeroom", { status: 400 });
  }
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) {
    throw new Response("Homeroom not found", { status: 404 });
  }

  const sort = new URL(request.url).searchParams.get("sort") === "space" ? "space" : "name";
  const students = await prisma.student.findMany({
    where: { homeRoom: teacher.homeRoom },
    orderBy:
      sort === "space"
        ? [{ spaceNumber: "asc" }, { lastName: "asc" }, { firstName: "asc" }]
        : [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      spaceNumber: true,
    },
  });

  return { homeRoom: teacher.homeRoom, students, sort };
}

export default function PrintHomeroom({ loaderData }: Route.ComponentProps) {
  const { homeRoom, students, sort } = loaderData;

  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <title>{`Homeroom: ${homeRoom}`}</title>
      <style>{`@page { size: letter; margin: 0.5in; }`}</style>
      <div className="p-6 text-black bg-white font-sans">
        <h1 className="text-xl font-semibold mb-1">Homeroom: {homeRoom}</h1>
        <p className="text-xs text-black/60 mb-3">
          Sorted by {sort === "space" ? "car space" : "name"}
        </p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1">Student</th>
              <th className="text-left py-1 w-32">Car space</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-black/10">
                <td className="py-0.5 align-top">
                  {s.firstName} {s.lastName}
                </td>
                <td className="py-0.5 align-top tabular-nums">
                  {s.spaceNumber != null ? s.spaceNumber : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
