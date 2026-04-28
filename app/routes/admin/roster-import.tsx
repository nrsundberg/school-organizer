import { useState } from "react";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Route } from "./+types/roster-import";
import {
  applyRosterImport,
  buildRosterImportPlanFromDatabase,
  parseRosterImportFile,
  parseSerializedRosterRows,
  RosterImportError,
  serializeRosterRows,
  type RosterImportPlan,
  type RosterPreviewRow,
} from "~/domain/csv/roster-import.server";
import type { ServerMessage } from "~/domain/types/server-message";
import {
  assertUsageAllowsIncrement,
  countOrgUsage,
  PlanLimitError,
  syncUsageGracePeriod,
} from "~/domain/billing/plan-usage.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { redirectWithSuccess } from "remix-toast";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export const handle = { i18n: ["admin", "errors", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Roster Import" },
];

type LocalizedRowError = {
  row: number;
  message: string;
};

type LocalizedPreviewRow = Omit<RosterPreviewRow, "message"> & {
  message: string;
};

type LocalizedPlan = Omit<RosterImportPlan, "rows"> & {
  rows: LocalizedPreviewRow[];
};

type PreviewActionData = {
  stage: "preview";
  plan: LocalizedPlan;
  rowErrors: LocalizedRowError[];
  warnings: string[];
  skippedBlank: number;
  rowsJson: string;
  planLimitError: string | null;
  canApply: boolean;
};

type ErrorActionData = {
  stage: "error";
  error: string;
};

type ActionData = PreviewActionData | ErrorActionData;

function translateServerMessage(t: TFunction, message: ServerMessage): string {
  return t(message.key, message.params ?? {}) as string;
}

function localizePlan(t: TFunction, plan: RosterImportPlan): LocalizedPlan {
  return {
    ...plan,
    rows: plan.rows.map((row) => ({
      ...row,
      message: translateServerMessage(t, row.message),
    })),
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [studentCount, homeroomCount, locale] = await Promise.all([
    prisma.student.count(),
    prisma.teacher.count(),
    detectLocale(request, context),
  ]);
  const t = await getFixedT(locale, "admin");

  return {
    studentCount,
    homeroomCount,
    metaTitle: t("rosterImport.metaTitle"),
  };
}

function importDelta(plan: RosterImportPlan) {
  return {
    students: plan.summary.createCount,
    families: plan.summary.createCount,
    classrooms: plan.summary.newHomerooms,
  };
}

async function usageErrorForPlan(
  context: Route.ActionArgs["context"],
  plan: RosterImportPlan,
): Promise<string | null> {
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const counts = await countOrgUsage(prisma, org.id);
  try {
    assertUsageAllowsIncrement(org, counts, importDelta(plan));
    return null;
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return error.message;
    }
    throw error;
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "preview");
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (intent === "preview") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return data<ActionData>(
        { stage: "error", error: t("rosterImport.errors.chooseFile") },
        { status: 400 },
      );
    }

    const parseResult = await parseRosterImportFile(file);
    if (!parseResult.ok) {
      return data<ActionData>(
        { stage: "error", error: translateServerMessage(t, parseResult.error) },
        { status: 400 },
      );
    }

    const plan = await buildRosterImportPlanFromDatabase(prisma, parseResult.rows);
    const planLimitError = await usageErrorForPlan(context, plan);
    const canApply =
      parseResult.rows.length > 0 &&
      parseResult.rowErrors.length === 0 &&
      plan.summary.errorCount === 0 &&
      !planLimitError;

    return data<ActionData>({
      stage: "preview",
      plan: localizePlan(t, plan),
      rowErrors: parseResult.rowErrors.map((err) => ({
        row: err.row,
        message: translateServerMessage(t, err.message),
      })),
      warnings: parseResult.warnings.map((warning) =>
        translateServerMessage(t, warning),
      ),
      skippedBlank: parseResult.skippedBlank,
      rowsJson: serializeRosterRows(parseResult.rows),
      planLimitError,
      canApply,
    });
  }

  if (intent === "apply") {
    let rows;
    try {
      rows = parseSerializedRosterRows(formData.get("rowsJson"));
    } catch (error) {
      const message =
        error instanceof RosterImportError
          ? translateServerMessage(t, error.serverMessage)
          : error instanceof Error
            ? error.message
            : t("rosterImport.errors.previewAgain");
      return data<ActionData>(
        {
          stage: "error",
          error: message,
        },
        { status: 400 },
      );
    }

    const plan = await buildRosterImportPlanFromDatabase(prisma, rows);
    const planLimitError = await usageErrorForPlan(context, plan);
    if (planLimitError) {
      return data<ActionData>({
        stage: "preview",
        plan: localizePlan(t, plan),
        rowErrors: [],
        warnings: [],
        skippedBlank: 0,
        rowsJson: serializeRosterRows(rows),
        planLimitError,
        canApply: false,
      });
    }

    const result = await applyRosterImport(prisma, rows);
    if (!result.ok) {
      return data<ActionData>(
        { stage: "error", error: translateServerMessage(t, result.error) },
        { status: 400 },
      );
    }
    const summary = result.data;
    const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
    if (freshOrg) {
      const nextCounts = await countOrgUsage(prisma, org.id);
      await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
    }

    const message =
      summary.newHomerooms > 0
        ? t("rosterImport.actions.importedSummaryWithHomerooms", {
            count: summary.created,
            created: summary.created,
            updated: summary.updated,
            homerooms: summary.newHomerooms,
          })
        : t("rosterImport.actions.importedSummary", {
            count: summary.created,
            created: summary.created,
            updated: summary.updated,
          });

    return redirectWithSuccess("/admin/children", { message });
  }

  return data<ActionData>(
    { stage: "error", error: t("rosterImport.errors.unknown") },
    { status: 400 },
  );
}

function StatusBadge({ status }: { status: "new" | "update" | "error" }) {
  const { t } = useTranslation("admin");
  const label =
    status === "new"
      ? t("rosterImport.status.new")
      : status === "update"
        ? t("rosterImport.status.update")
        : t("rosterImport.status.error");
  const classes =
    status === "new"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : status === "update"
        ? "bg-blue-500/15 text-blue-200 border-blue-500/30"
        : "bg-red-500/15 text-red-200 border-red-500/30";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: PreviewActionData }) {
  const { t } = useTranslation("admin");
  const visibleRows = preview.plan.rows.slice(0, 25);
  const totalErrors = preview.rowErrors.length + preview.plan.summary.errorCount;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#181d1d] p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-200/70">
            {t("rosterImport.preview.eyebrow")}
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            {preview.canApply
              ? t("rosterImport.preview.ready", {
                  count: preview.plan.summary.validRows,
                })
              : t("rosterImport.preview.review")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            {t("rosterImport.preview.intro")}
          </p>
        </div>
        {preview.canApply ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            {t("rosterImport.preview.noBlocking")}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {t("rosterImport.preview.fixRequired")}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SummaryCard
          label={t("rosterImport.preview.summary.validRows")}
          value={preview.plan.summary.validRows}
        />
        <SummaryCard
          label={t("rosterImport.preview.summary.newStudents")}
          value={preview.plan.summary.createCount}
        />
        <SummaryCard
          label={t("rosterImport.preview.summary.updates")}
          value={preview.plan.summary.updateCount}
        />
        <SummaryCard
          label={t("rosterImport.preview.summary.newHomerooms")}
          value={preview.plan.summary.newHomerooms}
        />
        <SummaryCard
          label={t("rosterImport.preview.summary.newSpaces")}
          value={preview.plan.summary.newSpaces}
        />
        <SummaryCard
          label={t("rosterImport.preview.summary.errors")}
          value={totalErrors}
        />
      </div>

      {preview.skippedBlank > 0 ? (
        <p className="mt-3 text-sm text-white/50">
          {t("rosterImport.preview.skippedBlank", {
            count: preview.skippedBlank,
          })}
        </p>
      ) : null}

      {preview.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
          {preview.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {preview.planLimitError ? (
        <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100">
          {preview.planLimitError}
        </div>
      ) : null}

      {preview.rowErrors.length > 0 ? (
        <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3">
          <h3 className="text-sm font-semibold text-red-100">
            {t("rosterImport.preview.rowsToFix")}
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-red-100/85">
            {preview.rowErrors.slice(0, 12).map((error) => (
              <li key={`${error.row}-${error.message}`}>
                {t("rosterImport.preview.rowError", {
                  row: error.row,
                  message: error.message,
                })}
              </li>
            ))}
          </ul>
          {preview.rowErrors.length > 12 ? (
            <p className="mt-2 text-sm text-red-100/70">
              {t("rosterImport.preview.moreErrors", {
                count: preview.rowErrors.length - 12,
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/45">
              <tr>
                <th className="px-4 py-3">{t("rosterImport.preview.table.row")}</th>
                <th className="px-4 py-3">{t("rosterImport.preview.table.status")}</th>
                <th className="px-4 py-3">{t("rosterImport.preview.table.student")}</th>
                <th className="px-4 py-3">{t("rosterImport.preview.table.homeroom")}</th>
                <th className="px-4 py-3">{t("rosterImport.preview.table.space")}</th>
                <th className="px-4 py-3">{t("rosterImport.preview.table.summary")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {visibleRows.map((row) => (
                <tr key={row.rowNumber} className="text-white/80">
                  <td className="px-4 py-3 text-white/50">{row.rowNumber}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {row.lastName}, {row.firstName}
                  </td>
                  <td className="px-4 py-3">
                    {row.homeRoom ?? t("rosterImport.preview.table.unassigned")}
                  </td>
                  <td className="px-4 py-3">
                    {row.spaceNumber ?? t("rosterImport.preview.table.unassigned")}
                  </td>
                  <td className="px-4 py-3 text-white/55">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.plan.rows.length > visibleRows.length ? (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
            {t("rosterImport.preview.showingFirstRows", {
              shown: visibleRows.length,
              total: preview.plan.rows.length,
            })}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Form method="post">
          <input type="hidden" name="intent" value="apply" />
          <input type="hidden" name="rowsJson" value={preview.rowsJson} />
          <Button
            type="submit"
            variant="primary"
            isDisabled={!preview.canApply}
            className="w-full sm:w-auto"
          >
            <Upload className="h-4 w-4" />
            {t("rosterImport.preview.import", {
              count: preview.plan.summary.validRows,
            })}
          </Button>
        </Form>
        <Link
          to="/admin/roster-import"
          className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {t("rosterImport.preview.uploadDifferent")}
        </Link>
      </div>
    </section>
  );
}

export default function AdminRosterImport({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const { t } = useTranslation("admin");
  const [fileName, setFileName] = useState("");
  const isSubmitting = navigation.state === "submitting";
  const preview = actionData?.stage === "preview" ? actionData : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-[#152323] via-[#1c2525] to-[#262217] p-6 shadow-2xl shadow-black/30">
        <div className="flex max-w-4xl flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-200/70">
              {t("rosterImport.hero.eyebrow")}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              {t("rosterImport.hero.heading")}
            </h1>
            <p className="mt-3 max-w-2xl text-white/65">
              <Trans
                t={t}
                i18nKey="rosterImport.hero.intro"
                components={[
                  <span className="font-mono text-white" key="0" />,
                  <span className="font-mono text-white" key="1" />,
                  <span className="font-mono text-white" key="2" />,
                  <span className="font-mono text-white" key="3" />,
                ]}
              />
            </p>
            <p className="mt-2 text-sm text-white/45">
              {t("rosterImport.hero.currentRoster", {
                count: loaderData.studentCount,
                homerooms: t("rosterImport.hero.homerooms", {
                  count: loaderData.homeroomCount,
                }),
              })}
            </p>
          </div>
          <a
            href="/admin/roster-template.csv"
            download
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            <Download className="h-4 w-4" />
            {t("rosterImport.hero.downloadTemplate")}
          </a>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-500/15 p-3 text-blue-200">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {t("rosterImport.upload.heading")}
            </h2>
            <p className="mt-1 text-sm text-white/55">
              {t("rosterImport.upload.subtitle")}
            </p>
            <Form
              method="post"
              encType="multipart/form-data"
              className="mt-4 flex flex-col gap-4 md:flex-row md:items-end"
            >
              <input type="hidden" name="intent" value="preview" />
              <label className="flex flex-1 flex-col gap-2 text-sm text-white/65" htmlFor="roster-file">
                {t("rosterImport.upload.fileLabel")}
                <input
                  id="roster-file"
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={(event) =>
                    setFileName(event.currentTarget.files?.item(0)?.name ?? "")
                  }
                  className="rounded-xl border border-white/15 bg-[#111616] px-3 py-2 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                />
                {fileName ? (
                  <span className="text-xs text-white/45">
                    {t("rosterImport.upload.selected", { name: fileName })}
                  </span>
                ) : null}
              </label>
              <Button
                type="submit"
                variant="primary"
                isDisabled={isSubmitting}
                isPending={isSubmitting}
              >
                {t("rosterImport.upload.previewSubmit")}
              </Button>
            </Form>
          </div>
        </div>
      </section>

      {actionData?.stage === "error" ? (
        <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
          {actionData.error}
        </div>
      ) : null}

      {preview ? <PreviewPanel preview={preview} /> : null}
    </div>
  );
}
