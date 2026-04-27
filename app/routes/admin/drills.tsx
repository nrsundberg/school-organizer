import { Form, Link, redirect } from "react-router";
import { ClipboardList, History, Library } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { defaultTemplateDefinition, parseDrillAudience, type DrillAudience } from "~/domain/drills/types";
import { StartLivePopover } from "~/domain/drills/StartLivePopover";
import { startDrillRun } from "~/domain/drills/live.server";
import { dataWithError, dataWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Drill checklists" },
];

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50";
const btnGhostDanger =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/10 transition-colors";

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const templates = await prisma.drillTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true, defaultAudience: true },
  });
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return { templates, metaTitle: t("drills.metaList") };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return dataWithError(null, t("drills.list.errors.nameRequired"));
    }
    const orgId = getOrgFromContext(context).id;
    const created = await prisma.drillTemplate.create({
      data: {
        orgId,
        name,
        definition: defaultTemplateDefinition() as object,
      },
    });
    throw redirect(`/admin/drills/${created.id}`);
  }

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    await prisma.drillTemplate.delete({ where: { id } });
    return dataWithSuccess(null, t("drills.list.errors.deleted"));
  }

  // "Run" on the list page now *starts a live drill* instead of opening the
  // edit-and-run screen — matches the red "Start live drill" button on the
  // edit page. We keep the flow in one place (startDrillRun) so the unique
  // "at most one live drill per org" invariant surfaces the same 409 toast.
  if (intent === "start-live") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, t("drills.list.errors.missingId"));
    }
    const audience = parseDrillAudience(formData.get("audience"));
    const orgId = getOrgFromContext(context).id;
    const actor = getActorIdsFromContext(context);
    try {
      await startDrillRun(prisma, orgId, id, undefined, actor, audience);
    } catch (err) {
      if (err instanceof Response && err.status === 409) {
        return dataWithError(null, t("drills.list.errors.anotherLive"));
      }
      console.error("[drills.list] start-live failed", err);
      throw err;
    }
    throw redirect("/drills/live");
  }

  return dataWithError(null, t("drills.list.errors.unknown"));
}


export default function AdminDrillList({ loaderData }: Route.ComponentProps) {
  const { templates } = loaderData;
  const { t, i18n } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <ClipboardList className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t("drills.list.heading")}</h1>
          <p className="text-white/50 text-sm mt-1">
            {t("drills.list.subtitle")}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-white/70">{t("drills.list.newHeading")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/drills/history"
              className={`${btnSecondary} text-xs`}
            >
              <History className="w-3.5 h-3.5 mr-1.5 inline" />
              {t("drills.list.viewHistory")}
            </Link>
            <Link
              to="/admin/drills/library"
              className={`${btnSecondary} text-xs`}
            >
              <Library className="w-3.5 h-3.5 mr-1.5 inline" />
              {t("drills.list.startFromLibrary")}
            </Link>
          </div>
        </div>
        <Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="intent" value="create" />
          <label className="text-sm text-white/60 flex flex-col gap-1 flex-1 min-w-[200px]">
            {t("drills.list.nameLabel")}
            <input
              name="name"
              type="text"
              required
              placeholder={t("drills.list.namePlaceholder")}
              className="app-field"
            />
          </label>
          <button type="submit" className={btnPrimary}>
            {t("drills.list.createBlank")}
          </button>
        </Form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white/70 mb-3">{t("drills.list.yourTemplates")}</h2>
        {templates.length === 0 ? (
          <p className="text-white/40 text-sm">{t("drills.list.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <Link
                    to={`/admin/drills/${tpl.id}`}
                    className="font-medium text-white hover:text-blue-300 transition-colors"
                  >
                    {tpl.name}
                  </Link>
                  <p className="text-xs text-white/40 mt-0.5">
                    {t("drills.list.updated", {
                      when: new Date(tpl.updatedAt).toLocaleString(i18n.language),
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StartLivePopover
                    templateId={tpl.id}
                    templateName={tpl.name}
                    defaultAudience={(tpl.defaultAudience ?? "EVERYONE") as DrillAudience}
                  />
                  <Link
                    to={`/admin/drills/${tpl.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    {t("drills.list.editLayout")}
                  </Link>
                  <Form method="post" onSubmit={(e) => !confirm(t("drills.list.confirmDelete")) && e.preventDefault()}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={tpl.id} />
                    <button type="submit" className={btnGhostDanger}>
                      {t("drills.list.delete")}
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
