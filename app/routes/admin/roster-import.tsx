import { useState } from "react";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import type { Route } from "./+types/roster-import";
import {
  applyRosterImport,
  buildRosterImportPlanFromDatabase,
  parseRosterImportFile,
  parseSerializedRosterRows,
  serializeRosterRows,
  type RosterImportPlan,
  type RosterRowError,
} from "~/domain/csv/roster-import.server";
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

export const meta: Route.MetaFunction = () => [{ title: "Admin – Roster Import" }];

type PreviewActionData = {
  stage: "preview";
  plan: RosterImportPlan;
  rowErrors: RosterRowError[];
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

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const [studentCount, homeroomCount] = await Promise.all([
    prisma.student.count(),
    prisma.teacher.count(),
  ]);

  return { studentCount, homeroomCount };
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

  if (intent === "preview") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return data<ActionData>(
        { stage: "error", error: "Choose a CSV file before previewing." },
        { status: 400 },
      );
    }

    const parseResult = await parseRosterImportFile(file);
    if (!parseResult.ok) {
      return data<ActionData>(
        { stage: "error", error: parseResult.error },
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
      plan,
      rowErrors: parseResult.rowErrors,
      warnings: parseResult.warnings,
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
      return data<ActionData>(
        {
          stage: "error",
          error: error instanceof Error ? error.message : "Preview the CSV again.",
        },
        { status: 400 },
      );
    }

    const plan = await buildRosterImportPlanFromDatabase(prisma, rows);
    const planLimitError = await usageErrorForPlan(context, plan);
    if (planLimitError) {
      return data<ActionData>({
        stage: "preview",
        plan,
        rowErrors: [],
        warnings: [],
        skippedBlank: 0,
        rowsJson: serializeRosterRows(rows),
        planLimitError,
        canApply: false,
      });
    }

    const summary = await applyRosterImport(prisma, rows);
    const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
    if (freshOrg) {
      const nextCounts = await countOrgUsage(prisma, org.id);
      await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
    }

    return redirectWithSuccess("/admin/children", {
      message:
        `Imported ${summary.created} new student${summary.created === 1 ? "" : "s"}` +
        ` and updated ${summary.updated} existing student${summary.updated === 1 ? "" : "s"}.` +
        (summary.newHomerooms > 0
          ? ` Created ${summary.newHomerooms} homeroom${summary.newHomerooms === 1 ? "" : "s"}.`
          : ""),
    });
  }

  return data<ActionData>(
    { stage: "error", error: "Unknown roster import action." },
    { status: 400 },
  );
}

function StatusBadge({ status }: { status: "new" | "update" | "error" }) {
  const label = status === "new" ? "New" : status === "update" ? "Update" : "Error";
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
  const visibleRows = preview.plan.rows.slice(0, 25);
  const totalErrors = preview.rowErrors.length + preview.plan.summary.errorCount;
  const importedRowsLabel = `${preview.plan.summary.validRows} row${
    preview.plan.summary.validRows === 1 ? "" : "s"
  }`;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#181d1d] p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-200/70">
            Preview
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            {preview.canApply
              ? `Ready to import ${importedRowsLabel}`
              : "Review before importing"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Nothing has been written yet. Confirming will create missing homerooms
            and board spaces, create new students, and update matching students by
            first name, last name, and homeroom.
          </p>
        </div>
        {preview.canApply ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            No blocking errors
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            Fix required
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SummaryCard label="Valid rows" value={preview.plan.summary.validRows} />
        <SummaryCard label="New students" value={preview.plan.summary.createCount} />
        <SummaryCard label="Updates" value={preview.plan.summary.updateCount} />
        <SummaryCard label="New homerooms" value={preview.plan.summary.newHomerooms} />
        <SummaryCard label="New spaces" value={preview.plan.summary.newSpaces} />
        <SummaryCard label="Errors" value={totalErrors} />
      </div>

      {preview.skippedBlank > 0 ? (
        <p className="mt-3 text-sm text-white/50">
          Skipped {preview.skippedBlank} blank row{preview.skippedBlank === 1 ? "" : "s"}.
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
          <h3 className="text-sm font-semibold text-red-100">Rows to fix</h3>
          <ul className="mt-2 space-y-1 text-sm text-red-100/85">
            {preview.rowErrors.slice(0, 12).map((error) => (
              <li key={`${error.row}-${error.message}`}>
                Row {error.row}: {error.message}
              </li>
            ))}
          </ul>
          {preview.rowErrors.length > 12 ? (
            <p className="mt-2 text-sm text-red-100/70">
              Plus {preview.rowErrors.length - 12} more row error
              {preview.rowErrors.length - 12 === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/45">
              <tr>
                <th className="px-4 py-3">Row</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Homeroom</th>
                <th className="px-4 py-3">Space</th>
                <th className="px-4 py-3">Summary</th>
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
                  <td className="px-4 py-3">{row.homeRoom ?? "Unassigned"}</td>
                  <td className="px-4 py-3">{row.spaceNumber ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-white/55">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.plan.rows.length > visibleRows.length ? (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
            Showing first {visibleRows.length} rows of {preview.plan.rows.length}.
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
            Import {preview.plan.summary.validRows} row
            {preview.plan.summary.validRows === 1 ? "" : "s"}
          </Button>
        </Form>
        <Link
          to="/admin/roster-import"
          className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          Upload a different CSV
        </Link>
      </div>
    </section>
  );
}

export default function AdminRosterImport({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const [fileName, setFileName] = useState("");
  const isSubmitting = navigation.state === "submitting";
  const preview = actionData?.stage === "preview" ? actionData : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-[#152323] via-[#1c2525] to-[#262217] p-6 shadow-2xl shadow-black/30">
        <div className="flex max-w-4xl flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-200/70">
              Roster setup
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white">Import roster</h1>
            <p className="mt-3 max-w-2xl text-white/65">
              Upload a CSV, preview every row, then confirm when the summary
              looks right. CSV columns are <span className="font-mono text-white">firstName</span>,{" "}
              <span className="font-mono text-white">lastName</span>,{" "}
              <span className="font-mono text-white">homeRoom</span>, and optional{" "}
              <span className="font-mono text-white">spaceNumber</span>.
            </p>
            <p className="mt-2 text-sm text-white/45">
              Current roster: {loaderData.studentCount} student
              {loaderData.studentCount === 1 ? "" : "s"} across {loaderData.homeroomCount} homeroom
              {loaderData.homeroomCount === 1 ? "" : "s"}.
            </p>
          </div>
          <a
            href="/admin/roster-template.csv"
            download
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            <Download className="h-4 w-4" />
            Download CSV template
          </a>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-500/15 p-3 text-blue-200">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">Upload CSV for preview</h2>
            <p className="mt-1 text-sm text-white/55">
              XLSX files are not supported yet. Export your spreadsheet as CSV
              first so the importer can validate it safely.
            </p>
            <Form
              method="post"
              encType="multipart/form-data"
              className="mt-4 flex flex-col gap-4 md:flex-row md:items-end"
            >
              <input type="hidden" name="intent" value="preview" />
              <label className="flex flex-1 flex-col gap-2 text-sm text-white/65" htmlFor="roster-file">
                CSV file
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
                  <span className="text-xs text-white/45">Selected: {fileName}</span>
                ) : null}
              </label>
              <Button
                type="submit"
                variant="primary"
                isDisabled={isSubmitting}
                isPending={isSubmitting}
              >
                Preview CSV
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
