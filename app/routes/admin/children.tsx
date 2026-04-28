import { Link } from "react-router";
import { Button } from "@heroui/react";
import { ChevronDown, ChevronRight, GraduationCap, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/children";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Children & Classes" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [classes, locale] = await Promise.all([
    prisma.teacher.findMany({
      orderBy: { homeRoom: "asc" },
      include: {
        students: {
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        },
      },
    }),
    detectLocale(request, context),
  ]);
  const t = await getFixedT(locale, "admin");
  return { classes, metaTitle: t("children.metaTitle") };
}

function ClassRow({ cls }: { cls: { id: number; homeRoom: string; students: { id: number; firstName: string; lastName: string; spaceNumber: number | null }[] } }) {
  const { t } = useTranslation("admin");
  const [expanded, setExpanded] = useState(false);
  const count = cls.students.length;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-white/40 flex-shrink-0" />
        )}
        <GraduationCap className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="font-medium text-white flex-1">{cls.homeRoom}</span>
        <span className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
          <Users className="w-3 h-3" />
          {count} {count === 1 ? t("children.child_one") : t("children.child_other")}
        </span>
        <Link
          to={`/edit/homeroom/${cls.id}`}
          onClick={(e) => e.stopPropagation()}
          className="ml-2 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          {t("children.edit")}
        </Link>
      </button>

      {expanded && (
        <div className="border-t border-white/10">
          {cls.students.length === 0 ? (
            <p className="px-6 py-3 text-white/40 text-sm">{t("children.noChildren")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase">
                  <th className="px-6 py-2 text-left font-medium">{t("children.table.name")}</th>
                  <th className="px-6 py-2 text-left font-medium">{t("children.table.space")}</th>
                  <th className="px-6 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {cls.students.map((student) => (
                  <tr key={student.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-6 py-2 text-white">
                      {student.lastName}, {student.firstName}
                    </td>
                    <td className="px-6 py-2 text-white/60">
                      {student.spaceNumber ?? <span className="text-white/30">—</span>}
                    </td>
                    <td className="px-6 py-2">
                      <Link
                        to={`/edit/student/${student.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {t("children.edit")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminChildren({ loaderData }: Route.ComponentProps) {
  const { classes } = loaderData;
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t("children.heading")}</h1>
        <div className="flex gap-2">
          <Link to="/admin/roster-import">
            <Button variant="secondary" size="sm">Import Roster</Button>
          </Link>
          <Link to="/create/homeroom">
            <Button variant="secondary" size="sm">{t("children.addClass")}</Button>
          </Link>
          <Link to="/create/student">
            <Button variant="primary" size="sm">{t("children.addChild")}</Button>
          </Link>
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
          {t("children.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {classes.map((cls) => (
            <ClassRow key={cls.id} cls={cls} />
          ))}
        </div>
      )}
    </div>
  );
}
