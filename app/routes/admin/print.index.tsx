import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileText, Printer, ScrollText, Users } from "lucide-react";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { StatusPill } from "~/components/admin/StatusPill";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import type { Route } from "./+types/print.index";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Printables" },
];

/**
 * Landing page for the printable backups previously inlined on the admin
 * dashboard. The actual print routes (`/admin/print/board`, `/print/master`,
 * `/print/homeroom/:teacherId`, `/print/drills/:templateId`) are unchanged —
 * this is a navigation hub so the dashboard can stay focused on today's
 * operations.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [teachers, drillTemplates] = await Promise.all([
    prisma.teacher.findMany({
      orderBy: { homeRoom: "asc" },
      select: { id: true, homeRoom: true },
    }),
    prisma.drillTemplate.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    metaTitle: t("printables.metaTitle"),
    teachers,
    drillTemplates,
  };
}

function PrintLink({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 text-sm text-blue-300 hover:text-blue-200 hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      {hint ? <span className="ml-1 text-white/40">· {hint}</span> : null}
    </a>
  );
}

export default function PrintIndex({ loaderData }: Route.ComponentProps) {
  const { teachers, drillTemplates } = loaderData;
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-8 p-6 max-w-5xl">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin"
          className="text-xs text-white/50 hover:text-white/80 hover:underline"
        >
          ← {t("printables.backToDashboard")}
        </Link>
        <div className="flex items-center gap-3">
          <Printer className="h-6 w-6 text-white/70" />
          <h1 className="text-2xl font-bold text-white">
            {t("printables.heading")}
          </h1>
        </div>
        <p className="text-sm text-white/55">{t("printables.subtitle")}</p>
      </header>

      {/* Pickup board */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title={t("printables.board.heading")}
          icon={<ScrollText className="h-4 w-4 text-blue-300" />}
          subtitle={t("printables.board.subtitle")}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <PrintLink
            href="/admin/print/board?fit=page"
            label={t("dashboard.print.fitPage")}
            hint={t("printables.board.fitPageHint")}
          />
          <span className="text-white/20">·</span>
          <PrintLink
            href="/admin/print/board?fit=grow"
            label={t("dashboard.print.naturalSize")}
            hint={t("printables.board.naturalSizeHint")}
          />
        </div>
      </section>

      {/* Master roster + per-homeroom */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title={t("printables.roster.heading")}
          icon={<Users className="h-4 w-4 text-cyan-300" />}
          subtitle={t("printables.roster.subtitle")}
        />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <PrintLink
            href="/admin/print/master"
            label={t("dashboard.print.masterList")}
          />
          {teachers.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.9px] text-white/45">
                  {t("dashboard.print.perHomeroom")}
                </h4>
                <StatusPill tone="neutral">{teachers.length}</StatusPill>
              </div>
              <ul className="space-y-1.5 text-sm text-white/80 max-h-72 overflow-y-auto">
                {teachers.map((tch) => (
                  <li
                    key={tch.id}
                    className="flex flex-wrap items-center gap-x-3"
                  >
                    <span className="text-white">{tch.homeRoom}</span>
                    <span className="text-white/30">·</span>
                    <PrintLink
                      href={`/admin/print/homeroom/${tch.id}?sort=name`}
                      label={t("dashboard.print.azSort")}
                    />
                    <span className="text-white/30">·</span>
                    <PrintLink
                      href={`/admin/print/homeroom/${tch.id}?sort=space`}
                      label={t("dashboard.print.spaceSort")}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-white/45">
              {t("printables.roster.emptyHomerooms")}
            </p>
          )}
        </div>
      </section>

      {/* Drill checklists */}
      {drillTemplates.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader
            title={t("printables.drills.heading")}
            icon={<FileText className="h-4 w-4 text-purple-300" />}
            subtitle={t("printables.drills.subtitle")}
          />
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <ul className="grid gap-2 sm:grid-cols-2">
              {drillTemplates.map((tpl) => (
                <li key={tpl.id}>
                  <PrintLink
                    href={`/admin/print/drills/${tpl.id}`}
                    label={tpl.name}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
