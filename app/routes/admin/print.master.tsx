// Print route — DO NOT use the user's UI locale for translations.
// The master list is staff-distributed, so it follows `org.defaultLocale`.
// Component-side, `usePrintLocale("master")` reads the resolved value
// from loader data; we pass `lng` to `useTranslation` so the printout's
// language matches the org default regardless of who's clicking Print.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/print.master";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { protectRoute } from "~/sessions.server";
import { getOrgDefaultLocale } from "~/i18n.server";
import { usePrintLocale } from "~/hooks/usePrintLocale";

export const handle = { i18n: ["admin"] };

export async function loader({ context }: Route.LoaderArgs) {
  await protectRoute(context);
  const prisma = getTenantPrisma(context);
  const studentsRaw = await prisma.student.findMany({
    orderBy: [{ household: { spaceNumber: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      homeRoom: true,
      household: { select: { spaceNumber: true } },
    },
  });
  const students = studentsRaw.map((s) => ({
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    homeRoom: s.homeRoom,
    spaceNumber: s.household?.spaceNumber ?? null,
  }));
  const printLocale = getOrgDefaultLocale(context);
  return { students, printLocale };
}

export default function PrintMaster({ loaderData }: Route.ComponentProps) {
  const { students } = loaderData;
  const printLocale = usePrintLocale("master");
  const { t } = useTranslation("admin", { lng: printLocale });

  useEffect(() => {
    const tm = setTimeout(() => window.print(), 300);
    return () => clearTimeout(tm);
  }, []);

  return (
    <>
      <title>{t("print.master.title")}</title>
      <style>{`@page { size: letter; margin: 0.5in; }`}</style>
      <div lang={printLocale} className="p-6 text-black bg-white font-sans">
        <h1 className="text-xl font-semibold mb-3">{t("print.master.heading")}</h1>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1 w-24">{t("print.master.space")}</th>
              <th className="text-left py-1">{t("print.master.student")}</th>
              <th className="text-left py-1 w-48">{t("print.master.homeroom")}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-black/10">
                <td className="py-0.5 align-top tabular-nums">
                  {s.spaceNumber != null ? s.spaceNumber : t("print.master.dash")}
                </td>
                <td className="py-0.5 align-top">
                  {s.firstName} {s.lastName}
                </td>
                <td className="py-0.5 align-top">{s.homeRoom ?? t("print.master.dash")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
