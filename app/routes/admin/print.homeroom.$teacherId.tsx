// Print route — DO NOT use the user's UI locale for translations.
// The homeroom printout is targeted at one teacher; honor `Teacher.locale`
// when set, otherwise fall back to `org.defaultLocale`. The server-side
// helper `getTeacherPrintLocale` resolves this for us. Component-side,
// `usePrintLocale("homeroom", teacherId)` reads the resolved value from
// loader data; we pass `lng` to `useTranslation` so the printout matches
// the teacher's preferred language even when the admin clicking Print
// uses something different.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/print.homeroom.$teacherId";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { requireRole } from "~/sessions.server";
import { getTeacherPrintLocale } from "~/i18n.server";
import { usePrintLocale } from "~/hooks/usePrintLocale";

export const handle = { i18n: ["admin"] };

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

  // Print locale rule: teacher.locale wins, else org.defaultLocale.
  const printLocale = await getTeacherPrintLocale(context, teacherId);

  return {
    homeRoom: teacher.homeRoom,
    teacher: { id: teacher.id },
    students,
    sort,
    printLocale,
  };
}

export default function PrintHomeroom({ loaderData }: Route.ComponentProps) {
  const { homeRoom, students, sort, teacher } = loaderData;
  const printLocale = usePrintLocale("homeroom", teacher.id);
  const { t } = useTranslation("admin", { lng: printLocale });

  useEffect(() => {
    const tm = setTimeout(() => window.print(), 300);
    return () => clearTimeout(tm);
  }, []);

  return (
    <>
      <title>{t("print.homeroom.title", { name: homeRoom })}</title>
      <style>{`@page { size: letter; margin: 0.5in; }`}</style>
      <div lang={printLocale} className="p-6 text-black bg-white font-sans">
        <h1 className="text-xl font-semibold mb-1">{t("print.homeroom.heading", { name: homeRoom })}</h1>
        <p className="text-xs text-black/60 mb-3">
          {sort === "space"
            ? t("print.homeroom.sortedByCarSpace")
            : t("print.homeroom.sortedByName")}
        </p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1">{t("print.homeroom.student")}</th>
              <th className="text-left py-1 w-32">{t("print.homeroom.carSpace")}</th>
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
