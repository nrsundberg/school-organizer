import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/data-delete";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
  getUserFromContext,
} from "~/domain/utils/global-context.server";
import { recordOrgAudit } from "~/domain/billing/comp.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Delete all data" },
];

/**
 * Loader: render a row-count snapshot + the confirmation form. Intentionally
 * NOT plan-gated — a downgraded org needs to be able to remove its own data
 * regardless of subscription tier (gating delete would be both bad UX and a
 * compliance risk).
 *
 * Reachable only via /admin/data-export's "Danger zone" link; not in the
 * sidebar so a "Delete all data" button is never one click from the
 * dashboard.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  const [studentsCount, teachersCount, callEventsCount, householdsCount] =
    await Promise.all([
      prisma.student.count({ where: { orgId: org.id } }),
      prisma.teacher.count({ where: { orgId: org.id } }),
      prisma.callEvent.count({ where: { orgId: org.id } }),
      prisma.household.count({ where: { orgId: org.id } }),
    ]);

  let lastExportedAt: string | null = null;
  try {
    const last = await (prisma as any).orgAuditLog.findFirst({
      where: { orgId: org.id, action: "data.export" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last?.createdAt instanceof Date) {
      lastExportedAt = last.createdAt.toISOString();
    } else if (typeof last?.createdAt === "string") {
      lastExportedAt = last.createdAt;
    }
  } catch {
    lastExportedAt = null;
  }

  // "Recent" = the school exported in the last 7 days. Used to suppress the
  // "you should export first" upsell — if they just did, don't nag.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const hasRecentExport =
    lastExportedAt !== null &&
    new Date(lastExportedAt).getTime() > Date.now() - SEVEN_DAYS_MS;

  return {
    orgName: org.name,
    orgSlug: org.slug,
    metaTitle: t("dataDelete.metaTitle"),
    rowCounts: {
      students: studentsCount,
      teachers: teachersCount,
      callEvents: callEventsCount,
      households: householdsCount,
    },
    hasRecentExport,
  };
}

/**
 * Action: validate the slug-typed-into-input + the acknowledgement
 * checkbox, snapshot row counts, then walk the cascade in dependency order
 * inside a single Prisma transaction. The Org row + every Stripe-linked
 * column on it is preserved so billing continuity isn't broken.
 *
 * The executing admin's User row is intentionally skipped so the action
 * doesn't take out its own session mid-request. The dashboard banner
 * surfaces a "sign out when ready" cleanup hint.
 */
export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const me = getUserFromContext(context);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  const formData = await request.formData();
  const confirmSlug = String(formData.get("confirmSlug") ?? "").trim();
  const acknowledged = String(formData.get("acknowledged") ?? "");

  if (confirmSlug !== org.slug) {
    return new Response(
      JSON.stringify({
        error: t("dataDelete.errors.slugMismatch", { slug: org.slug }),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  if (acknowledged !== "on") {
    return new Response(
      JSON.stringify({ error: t("dataDelete.errors.ackRequired") }),
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  const where = { orgId: org.id };

  // Snapshot what's about to disappear. The audit log entry below stores
  // these counts so a forensic question ("how many call events did this
  // org have when they wiped?") still has an answer post-delete.
  const rowCountsBefore = {
    programCancellations: await prisma.programCancellation.count({ where }),
    afterSchoolPrograms: await prisma.afterSchoolProgram.count({ where }),
    dismissalExceptions: await prisma.dismissalException.count({ where }),
    callEvents: await prisma.callEvent.count({ where }),
    students: await prisma.student.count({ where }),
    teachers: await prisma.teacher.count({ where }),
    spaces: await prisma.space.count({ where }),
    households: await prisma.household.count({ where }),
    users: await prisma.user.count({ where }),
  };

  // Deletes are wrapped in a single $transaction. Order respects FK chains:
  // dependents (callEvents, programCancellations, dismissalExceptions) before
  // their parents (Space/Student/Program/Household). User comes last, with
  // an explicit `NOT: { id: me.id }` to keep the executing admin's session
  // alive (Open Q #2 / Option A in the research spec).
  await prisma.$transaction([
    prisma.programCancellation.deleteMany({ where }),
    prisma.afterSchoolProgram.deleteMany({ where }),
    prisma.dismissalException.deleteMany({ where }),
    prisma.callEvent.deleteMany({ where }),
    prisma.viewerAccessSession.deleteMany({ where }),
    prisma.viewerAccessAttempt.deleteMany({ where }),
    prisma.viewerMagicLink.deleteMany({ where }),
    prisma.appSettings.deleteMany({ where }),
    prisma.student.deleteMany({ where }),
    prisma.teacher.deleteMany({ where }),
    prisma.space.deleteMany({ where }),
    prisma.household.deleteMany({ where }),
    // DrillRunEvent rows are scoped via DrillRun -> Org; they're cascaded
    // when the DrillRun rows are deleted. If a future schema change inverts
    // that we'd add an explicit deleteMany before drillRun.
    prisma.drillRun.deleteMany({ where }),
    prisma.drillTemplate.deleteMany({ where }),
    prisma.user.deleteMany({
      where: { orgId: org.id, NOT: { id: me?.id ?? "" } },
    }),
  ]);

  // Audit log entry, OUTSIDE the txn so a delete-success is recorded even
  // if a follow-up housekeeping step (R2 logo cleanup, board DO reset)
  // fails. Keep this best-effort: a failure here mustn't undo the delete.
  try {
    await recordOrgAudit({
      context,
      orgId: org.id,
      actorUserId: me?.id ?? null,
      action: "data.delete_all",
      payload: {
        confirmedSlug: confirmSlug,
        rowCountsBefore,
        rowCountsAfter: {
          students: 0,
          teachers: 0,
          callEvents: 0,
          households: 0,
          dismissalExceptions: 0,
          afterSchoolPrograms: 0,
          programCancellations: 0,
          users: 0,
        },
        executorPreserved: me?.id ?? null,
      },
    });
  } catch {
    // Don't fail the request on a missing audit log delegate (same
    // workaround `comp.server.ts` uses elsewhere).
  }

  // TODO follow-up #5.1: invalidate the BINGO_BOARD Durable Object cache so
  // viewers don't see ghost rows for ~30s. Punted per spec recommendation.
  // TODO follow-up: best-effort R2 logo cleanup if Org.logoObjectKey is set.

  return redirect("/admin?dataDeleted=1");
}

type ActionResult = { error?: string };

export default function DataDeletePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("admin");
  const actionData = useActionData<ActionResult>();
  const nav = useNavigation();
  const submitting =
    nav.state === "submitting" && nav.formAction === "/admin/data-delete";

  const [slugInput, setSlugInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const slugMatches = slugInput.trim() === loaderData.orgSlug;
  const canSubmit = slugMatches && acknowledged && !submitting;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-white">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-red-200">
          {t("dataDelete.heading")}
        </h1>
      </header>

      <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-5 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 text-red-400 flex-shrink-0" />
          <div className="space-y-3">
            <p className="text-sm text-white/85">
              {t("dataDelete.warningParagraph1", {
                orgName: loaderData.orgName,
              })}
            </p>
            <p className="text-sm text-white/70">
              {t("dataDelete.warningParagraph2")}
            </p>
            <p className="text-sm text-white/70">
              {t("dataDelete.warningParagraph3Prefix")}
              <Link
                to="/admin/data-export"
                className="underline text-yellow-200 hover:text-yellow-100"
              >
                {t("dataDelete.warningParagraph3LinkText")}
              </Link>
              {t("dataDelete.warningParagraph3Suffix")}
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold mb-3">
          {t("dataDelete.preview.title")}
        </h2>
        <ul className="text-sm text-white/80 space-y-1">
          <li>
            {t("dataDelete.preview.studentsCount", {
              count: loaderData.rowCounts.students,
            })}
          </li>
          <li>
            {t("dataDelete.preview.teachersCount", {
              count: loaderData.rowCounts.teachers,
            })}
          </li>
          <li>
            {t("dataDelete.preview.callEventsCount", {
              count: loaderData.rowCounts.callEvents,
            })}
          </li>
          <li>
            {t("dataDelete.preview.householdsCount", {
              count: loaderData.rowCounts.households,
            })}
          </li>
        </ul>
      </section>

      <Form
        method="post"
        action="/admin/data-delete"
        className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-4"
      >
        <label className="flex flex-col gap-2 text-sm text-white/70">
          {t("dataDelete.confirmInputLabel", { slug: loaderData.orgSlug })}
          <input
            type="text"
            name="confirmSlug"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white font-mono"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            name="acknowledged"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          {t("dataDelete.acknowledgeLabel")}
        </label>

        {actionData?.error ? (
          <p className="text-sm text-red-400">{actionData.error}</p>
        ) : null}

        <Button
          type="submit"
          color="danger"
          isDisabled={!canSubmit}
          className="w-fit"
        >
          {submitting
            ? t("dataDelete.deletingButton")
            : t("dataDelete.deleteButton")}
        </Button>
      </Form>
    </div>
  );
}
