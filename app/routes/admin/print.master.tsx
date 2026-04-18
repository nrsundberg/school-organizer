import { useEffect } from "react";
import type { Route } from "./+types/print.master";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { requireRole } from "~/sessions.server";

export async function loader({ context }: Route.LoaderArgs) {
  await requireRole(context, "ADMIN");
  const prisma = getTenantPrisma(context);
  const students = await prisma.student.findMany({
    orderBy: [{ spaceNumber: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      spaceNumber: true,
      homeRoom: true,
    },
  });
  return { students };
}

export default function PrintMaster({ loaderData }: Route.ComponentProps) {
  const { students } = loaderData;

  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <title>Master list — by car space</title>
      <style>{`@page { size: letter; margin: 0.5in; }`}</style>
      <div className="p-6 text-black bg-white font-sans">
        <h1 className="text-xl font-semibold mb-3">Master list — by car space number</h1>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1 w-24">Space</th>
              <th className="text-left py-1">Student</th>
              <th className="text-left py-1 w-48">Homeroom</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-black/10">
                <td className="py-0.5 align-top tabular-nums">
                  {s.spaceNumber != null ? s.spaceNumber : "—"}
                </td>
                <td className="py-0.5 align-top">
                  {s.firstName} {s.lastName}
                </td>
                <td className="py-0.5 align-top">{s.homeRoom ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
