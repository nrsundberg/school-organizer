import { Form, Link, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { AlertTriangle, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { zip, strToU8 } from "fflate";
import type { Route } from "./+types/data-export";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
  getUserFromContext,
} from "~/domain/utils/global-context.server";
import { recordOrgAudit } from "~/domain/billing/comp.server";
import { planAllowsReports } from "~/lib/plan-limits";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import {
  buildManifest,
  EXPORT_WHITELIST,
  whitelistRow,
  type ExportTable,
} from "~/lib/data-export.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Data export" },
];

/**
 * Loader: plan-gate the page (CAMPUS+ only) and render a row-count preview
 * so the admin sees what they're about to download. The audit log is also
 * queried for "last exported at" so a recent export is visible.
 *
 * The destructive action lives at /admin/data-delete; we surface a
 * "Danger zone" card from inside this page rather than the sidebar so the
 * delete button is one deliberate click away from the export it should
 * always follow.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (!planAllowsReports(org.billingPlan)) {
    return {
      upgradeRequired: true as const,
      orgName: org.name,
      orgSlug: org.slug,
      billingPlan: org.billingPlan,
      metaTitle: t("dataExport.metaTitle"),
    };
  }

  // Parallel counts so the preview is one round-trip rather than nine.
  const [
    studentsCount,
    teachersCount,
    spacesCount,
    callEventsCount,
    usersCount,
    householdsCount,
    exceptionsCount,
    programsCount,
    cancellationsCount,
  ] = await Promise.all([
    prisma.student.count({ where: { orgId: org.id } }),
    prisma.teacher.count({ where: { orgId: org.id } }),
    prisma.space.count({ where: { orgId: org.id } }),
    prisma.callEvent.count({ where: { orgId: org.id } }),
    prisma.user.count({ where: { orgId: org.id } }),
    prisma.household.count({ where: { orgId: org.id } }),
    prisma.dismissalException.count({ where: { orgId: org.id } }),
    prisma.afterSchoolProgram.count({ where: { orgId: org.id } }),
    prisma.programCancellation.count({ where: { orgId: org.id } }),
  ]);

  // Latest data.export audit entry. Cast through `any` is the same workaround
  // recordOrgAudit uses (the OrgAuditLog delegate isn't always present in the
  // checked-in generated client — see comp.server.ts).
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
    // OrgAuditLog client may be missing in a freshly-generated dev DB; the
    // page is still useful without the "last exported" line.
    lastExportedAt = null;
  }

  return {
    upgradeRequired: false as const,
    orgName: org.name,
    orgSlug: org.slug,
    billingPlan: org.billingPlan,
    metaTitle: t("dataExport.metaTitle"),
    lastExportedAt,
    rowCounts: {
      students: studentsCount,
      teachers: teachersCount,
      spaces: spacesCount,
      callEvents: callEventsCount,
      users: usersCount,
      households: householdsCount,
      dismissalExceptions: exceptionsCount,
      afterSchoolPrograms: programsCount,
      programCancellations: cancellationsCount,
    },
  };
}

/**
 * Action: build the zip and stream it back as `application/zip`. The plan
 * gate is repeated here so a crafted POST from a downgraded org can't
 * bypass the loader's check.
 *
 * v1 builds the zip in memory rather than streaming (fflate's async `zip`
 * is simpler to reason about + a CAMPUS-cap org's full dump still comes in
 * well under the Worker's 128 MB heap). If a tenant ever pushes beyond
 * ~30 MB compressed we should switch to the streaming `Zip` constructor;
 * see docs/nightly-specs/2026-04-27-data-export-delete.md § 4.
 */
export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (!planAllowsReports(org.billingPlan)) {
    return new Response(t("dataExport.upgrade.zipForbidden"), {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const me = getUserFromContext(context);

  // Pull every table; whitelist + Date-normalize each row before it
  // touches the JSON encoder. Pagination caps lift only on extreme orgs;
  // see the spec § "D1 row-count limits" for the threshold rationale.
  const PAGE = 5000;
  async function pageAll<T>(
    fetch: (skip: number) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const batch = await fetch(skip);
      out.push(...batch);
      if (batch.length < PAGE) break;
    }
    return out;
  }

  const where = { orgId: org.id };

  const [
    students,
    teachers,
    spaces,
    callEvents,
    users,
    households,
    dismissalExceptions,
    afterSchoolPrograms,
    programCancellations,
    appSettings,
    auditLog,
  ] = await Promise.all([
    pageAll((skip) =>
      prisma.student.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { id: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.teacher.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { id: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.space.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { id: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.callEvent.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { id: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.user.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { createdAt: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.household.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { createdAt: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.dismissalException.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { createdAt: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.afterSchoolProgram.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { createdAt: "asc" },
      }),
    ),
    pageAll((skip) =>
      prisma.programCancellation.findMany({
        where,
        skip,
        take: PAGE,
        orderBy: { createdAt: "asc" },
      }),
    ),
    prisma.appSettings.findMany({ where }),
    // OrgAuditLog client may not be on the generated client checked into
    // the repo; cast + fallback to [] so the export still ships data even
    // if the audit dump is unavailable.
    (async () => {
      try {
        return await pageAll((skip) =>
          (prisma as any).orgAuditLog.findMany({
            where,
            skip,
            take: PAGE,
            orderBy: { createdAt: "asc" },
          }),
        );
      } catch {
        return [] as Array<Record<string, unknown>>;
      }
    })(),
  ]);

  const filtered: Record<string, unknown> = {
    students: students.map((r) => whitelistRow("students", r as never)),
    teachers: teachers.map((r) => whitelistRow("teachers", r as never)),
    spaces: spaces.map((r) => whitelistRow("spaces", r as never)),
    callEvents: callEvents.map((r) => whitelistRow("callEvents", r as never)),
    users: users.map((r) => whitelistRow("users", r as never)),
    households: households.map((r) => whitelistRow("households", r as never)),
    dismissalExceptions: dismissalExceptions.map((r) =>
      whitelistRow("dismissalExceptions", r as never),
    ),
    afterSchoolPrograms: afterSchoolPrograms.map((r) =>
      whitelistRow("afterSchoolPrograms", r as never),
    ),
    programCancellations: programCancellations.map((r) =>
      whitelistRow("programCancellations", r as never),
    ),
    appSettings: appSettings.map((r) =>
      whitelistRow("appSettings", r as never),
    ),
    auditLog: auditLog.map((r) =>
      whitelistRow("auditLog", r as Record<string, unknown>),
    ),
  };

  const rowCounts: Partial<Record<ExportTable, number>> = {};
  for (const k of Object.keys(EXPORT_WHITELIST) as ExportTable[]) {
    const arr = filtered[k] as unknown[] | undefined;
    rowCounts[k] = arr?.length ?? 0;
  }

  const exportedAt = new Date();
  const manifest = buildManifest({
    orgId: org.id,
    orgSlug: org.slug,
    exportedAt,
    exportedByUserId: me?.id ?? null,
    planAtExport: org.billingPlan,
    rowCounts,
  });

  // Each entry is a separate file inside the zip.
  const fileMap: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (const [table, rows] of Object.entries(filtered)) {
    const filename =
      table === "auditLog"
        ? "audit-log.json"
        : `${kebab(table)}.json`;
    fileMap[filename] = strToU8(JSON.stringify(rows, null, 2));
  }

  const archive: Uint8Array = await new Promise((resolve, reject) => {
    zip(fileMap, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  // Audit log: only on success. A streamed Response that errors mid-flight
  // would never reach this point because the await above throws first.
  const ymd = exportedAt.toISOString().slice(0, 10);
  const filename = `${org.slug}-data-export-${ymd}.zip`;

  try {
    await recordOrgAudit({
      context,
      orgId: org.id,
      actorUserId: me?.id ?? null,
      action: "data.export",
      payload: { filename, byteSize: archive.byteLength, rowCounts },
    });
  } catch {
    // Audit failures must not prevent the user from getting their data.
    // Worst case the audit log doesn't record this export — the alternative
    // (silently 500ing on a download click) is strictly worse.
  }

  // Uint8Array is a valid BodyInit at runtime (Cloudflare Workers + browsers
  // both accept it), but TS's lib.dom DOM-only BodyInit + BlobPart
  // narrowings disagree. Cast to ArrayBuffer via .buffer to satisfy both —
  // fflate's `zip` returns a Uint8Array view onto a fresh buffer, so this
  // cast is a no-op at runtime.
  const archiveBuffer = archive.buffer as ArrayBuffer;
  return new Response(archiveBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export default function DataExportPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("admin");
  const nav = useNavigation();
  const submitting =
    nav.state === "submitting" && nav.formAction === "/admin/data-export";

  if (loaderData.upgradeRequired) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6 text-white">
        <h1 className="text-2xl font-semibold">{t("dataExport.heading")}</h1>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
          <p className="text-sm font-semibold">
            {t("dataExport.upgrade.title")}
          </p>
          <p className="mt-2 text-sm text-white/60">
            {t("dataExport.upgrade.body")}
          </p>
          <Link
            to="/admin/billing"
            className="mt-4 inline-block rounded bg-[#E9D500] px-3 py-1.5 text-xs font-semibold text-[#193B4B] hover:brightness-105"
          >
            {t("dataExport.upgrade.cta")}
          </Link>
        </div>
      </div>
    );
  }

  const { rowCounts, lastExportedAt } = loaderData;
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-white">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("dataExport.heading")}</h1>
        <p className="text-sm text-white/60">{t("dataExport.description")}</p>
      </header>

      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold mb-3">
          {t("dataExport.preview.title")}
        </h2>
        <ul className="space-y-1 text-sm text-white/80">
          <li>
            {t("dataExport.preview.studentsCount", {
              count: rowCounts.students,
            })}
          </li>
          <li>
            {t("dataExport.preview.teachersCount", {
              count: rowCounts.teachers,
            })}
          </li>
          <li>
            {t("dataExport.preview.callEventsCount", {
              count: rowCounts.callEvents,
            })}
          </li>
          <li>
            {t("dataExport.preview.householdsCount", {
              count: rowCounts.households,
            })}
          </li>
          <li>
            {t("dataExport.preview.exceptionsCount", {
              count: rowCounts.dismissalExceptions,
            })}
          </li>
        </ul>

        <Form
          method="post"
          action="/admin/data-export"
          className="mt-5 flex items-center gap-3"
          reloadDocument
        >
          <Button
            type="submit"
            variant="primary"
            isDisabled={submitting}
          >
            <Download className="h-4 w-4" />
            {submitting
              ? t("dataExport.downloadingButton")
              : t("dataExport.downloadButton")}
          </Button>
          {lastExportedAt ? (
            <span className="text-xs text-white/50">
              {t("dataExport.lastExportedAt", {
                time: new Date(lastExportedAt).toLocaleString(),
              })}
            </span>
          ) : null}
        </Form>
      </section>

      <section className="rounded-lg border border-red-500/30 bg-red-500/[0.04] p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 text-red-400 flex-shrink-0" />
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-red-200">
              {t("dataExport.dangerZone.title")}
            </h2>
            <p className="text-sm text-white/70">
              {t("dataExport.dangerZone.body")}
            </p>
            <Link
              to="/admin/data-delete"
              className="inline-block rounded border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
            >
              {t("dataExport.dangerZone.cta")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
