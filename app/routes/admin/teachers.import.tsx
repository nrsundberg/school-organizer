import { useState } from "react";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Mail,
  Upload,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Route } from "./+types/teachers.import";
import { parseSpreadsheetToGrid } from "~/domain/csv/spreadsheet.server";
import {
  parseSerializedGrid,
  serializeGrid,
  buildErrorReportCsv,
} from "~/domain/csv/roster-import.server";
import {
  applyTeacherImport,
  applyTeacherMapping,
  buildTeacherImportPlan,
  parseSerializedTeacherRows,
  serializeTeacherRows,
  suggestTeacherMapping,
  type InviteTeacherFn,
  type TeacherColumnMapping,
  type TeacherField,
  type TeacherImportPlan,
  type TeacherPlanPrisma,
  type TeacherRole,
  type TeacherWritePrisma,
} from "~/domain/teachers/teacher-import.server";
import type { ServerMessage } from "~/domain/types/server-message";
import { inviteUser } from "~/domain/admin-users/invite-user.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { getPrisma } from "~/db.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { redirectWithSuccess } from "remix-toast";
import { getAdminT } from "~/lib/t.server";

export const handle = { i18n: ["admin", "errors", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Import Teachers" },
];

const ROLES: TeacherRole[] = ["VIEWER", "CONTROLLER"];
// Defined here (not imported from the .server module) so the client bundle
// never references server-only code. See React Router code-splitting.
const TEACHER_FIELDS: TeacherField[] = ["name", "email", "homeRoom", "role"];
const REQUIRED_FIELDS: TeacherField[] = ["name", "email", "homeRoom"];

type LocalizedRowError = { row: number; message: string };

type MapActionData = {
  stage: "map";
  header: string[];
  suggestion: TeacherColumnMapping;
  gridJson: string;
  defaultRole: TeacherRole;
  mappingError: string | null;
};

type PreviewActionData = {
  stage: "preview";
  plan: TeacherImportPlan;
  rowErrors: LocalizedRowError[];
  skippedBlank: number;
  rowsJson: string;
  errorReportCsv: string;
  canApply: boolean;
};

type ErrorActionData = { stage: "error"; error: string };

type ActionData = MapActionData | PreviewActionData | ErrorActionData;

function translateServerMessage(t: TFunction, message: ServerMessage): string {
  return t(message.key, message.params ?? {}) as string;
}

function readMappingFromForm(formData: FormData): TeacherColumnMapping {
  const read = (field: TeacherField): number | null => {
    const value = formData.get(`map_${field}`);
    if (typeof value !== "string" || value === "") return null;
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : null;
  };
  return {
    name: read("name"),
    email: read("email"),
    homeRoom: read("homeRoom"),
    role: read("role"),
  };
}

function readDefaultRole(formData: FormData): TeacherRole {
  return formData.get("defaultRole") === "CONTROLLER" ? "CONTROLLER" : "VIEWER";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const teacherCount = await prisma.teacher.count();
  const t = await getAdminT(request, context);
  return { teacherCount, metaTitle: t("teacherImport.metaTitle") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const actor = getActorIdsFromContext(context);
  const org = getOrgFromContext(context);
  const tenantPrisma = getTenantPrisma(context);
  const globalPrisma = getPrisma(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "upload");
  const t = await getAdminT(request, context);

  // Stage 1 — parse the file and suggest a mapping.
  if (intent === "upload") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return data<ActionData>(
        { stage: "error", error: t("teacherImport.errors.chooseFile") },
        { status: 400 },
      );
    }
    const parsed = await parseSpreadsheetToGrid(file);
    if (!parsed.ok) {
      return data<ActionData>(
        { stage: "error", error: translateServerMessage(t, parsed.error) },
        { status: 400 },
      );
    }
    return data<ActionData>({
      stage: "map",
      header: parsed.grid.header,
      suggestion: suggestTeacherMapping(parsed.grid.header),
      gridJson: serializeGrid(parsed.grid),
      defaultRole: "VIEWER",
      mappingError: null,
    });
  }

  // Stage 2 — apply the mapping + default role and preview the invites.
  if (intent === "preview") {
    let grid;
    try {
      grid = parseSerializedGrid(formData.get("gridJson"));
    } catch {
      return data<ActionData>(
        { stage: "error", error: t("teacherImport.errors.previewAgain") },
        { status: 400 },
      );
    }
    const mapping = readMappingFromForm(formData);
    const defaultRole = readDefaultRole(formData);
    const mapped = applyTeacherMapping(grid, mapping, defaultRole);
    if (!mapped.ok) {
      return data<ActionData>({
        stage: "map",
        header: grid.header,
        suggestion: mapping,
        gridJson: serializeGrid(grid),
        defaultRole,
        mappingError: translateServerMessage(t, mapped.error),
      });
    }

    const plan = await buildTeacherImportPlan(
      { user: globalPrisma.user, teacher: tenantPrisma.teacher } as unknown as TeacherPlanPrisma,
      mapped.rows,
    );
    const rowErrors = mapped.rowErrors.map((err) => ({
      row: err.row,
      message: translateServerMessage(t, err.message),
    }));

    return data<ActionData>({
      stage: "preview",
      plan,
      rowErrors,
      skippedBlank: mapped.skippedBlank,
      rowsJson: serializeTeacherRows(mapped.rows),
      errorReportCsv: buildErrorReportCsv(rowErrors),
      canApply: mapped.rows.length > 0,
    });
  }

  // Stage 3 — create homerooms + invite each teacher.
  if (intent === "apply") {
    let rows;
    try {
      rows = parseSerializedTeacherRows(formData.get("rowsJson"));
    } catch {
      return data<ActionData>(
        { stage: "error", error: t("teacherImport.errors.previewAgain") },
        { status: 400 },
      );
    }

    const invite: InviteTeacherFn = async (row) => {
      const result = await inviteUser(context, {
        request,
        email: row.email,
        name: row.name,
        role: row.role,
        scope: { kind: "org", id: org.id },
        invitedByUserId: actor.actorUserId ?? me.id,
        invitedByOnBehalfOfUserId: actor.onBehalfOfUserId,
        invitedByEmail: (me as { email?: string }).email ?? null,
        invitedToLabel: org.name,
      });
      if (result.ok) return "invited";
      return result.error === "user-exists" ? "existing" : "failed";
    };

    const summary = await applyTeacherImport(
      tenantPrisma as unknown as TeacherWritePrisma,
      rows,
      invite,
    );

    const message = t("teacherImport.actions.imported", {
      invited: summary.invited,
      existing: summary.existing,
      classrooms: summary.teachersCreated,
      failed: summary.failed,
    });
    return redirectWithSuccess("/admin/classrooms", { message });
  }

  return data<ActionData>(
    { stage: "error", error: t("teacherImport.errors.unknown") },
    { status: 400 },
  );
}

function StatusBadge({ status }: { status: "invite" | "existing" }) {
  const { t } = useTranslation("admin");
  const classes =
    status === "invite"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : "bg-white/10 text-white/60 border-white/20";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {t(`teacherImport.status.${status}`)}
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

function MappingPanel({ map }: { map: MapActionData }) {
  const { t } = useTranslation("admin");
  return (
    <section className="rounded-2xl border border-white/10 bg-[#181d1d] p-5 shadow-2xl shadow-black/20">
      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-200/70">
        {t("teacherImport.mapping.eyebrow")}
      </p>
      <h2 className="mt-2 text-xl font-bold text-white">
        {t("teacherImport.mapping.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-white/60">
        {t("teacherImport.mapping.intro")}
      </p>

      {map.mappingError ? (
        <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100">
          {map.mappingError}
        </div>
      ) : null}

      <Form method="post" className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="intent" value="preview" />
        <input type="hidden" name="gridJson" value={map.gridJson} />

        <div className="grid gap-4 sm:grid-cols-2">
          {TEACHER_FIELDS.map((field) => {
            const required = REQUIRED_FIELDS.includes(field);
            const selected = map.suggestion[field];
            return (
              <label key={field} className="flex flex-col gap-1.5 text-sm text-white/70">
                <span>
                  {t(`teacherImport.mapping.field.${field}`)}{" "}
                  <span className="text-xs text-white/40">
                    ({t(required ? "teacherImport.mapping.required" : "teacherImport.mapping.optional")})
                  </span>
                </span>
                <select
                  name={`map_${field}`}
                  defaultValue={selected == null ? "" : String(selected)}
                  className="rounded-xl border border-white/15 bg-[#111616] px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                >
                  <option value="">
                    {required
                      ? t("teacherImport.mapping.selectColumn")
                      : t("teacherImport.mapping.notImported")}
                  </option>
                  {map.header.map((label, index) => (
                    <option key={index} value={String(index)}>
                      {label || `#${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        <label className="flex max-w-xs flex-col gap-1.5 text-sm text-white/70">
          <span>{t("teacherImport.mapping.defaultRole")}</span>
          <select
            name="defaultRole"
            defaultValue={map.defaultRole}
            className="rounded-xl border border-white/15 bg-[#111616] px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`teacherImport.roles.${role}`)}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">
            {t("teacherImport.mapping.defaultRoleHint")}
          </span>
        </label>

        <div className="mt-1 flex flex-col gap-3 sm:flex-row">
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            {t("teacherImport.mapping.submit")}
          </Button>
          <Link
            to="/admin/teachers/import"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t("teacherImport.mapping.uploadDifferent")}
          </Link>
        </div>
      </Form>
    </section>
  );
}

function PreviewPanel({ preview }: { preview: PreviewActionData }) {
  const { t } = useTranslation("admin");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const hasErrors = preview.rowErrors.length > 0;
  const total = preview.plan.summary.total;
  const canImport = preview.canApply && (!hasErrors || skipInvalid);
  const errorReportHref = `data:text/csv;charset=utf-8,${encodeURIComponent(
    preview.errorReportCsv,
  )}`;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#181d1d] p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-blue-200/70">
            {t("teacherImport.preview.eyebrow")}
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            {t("teacherImport.preview.heading", {
              count: preview.plan.summary.inviteCount,
            })}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            {t("teacherImport.preview.intro")}
          </p>
        </div>
        {canImport ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            {t("teacherImport.preview.ready")}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {t("teacherImport.preview.fixRequired")}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label={t("teacherImport.preview.summary.total")} value={total} />
        <SummaryCard
          label={t("teacherImport.preview.summary.toInvite")}
          value={preview.plan.summary.inviteCount}
        />
        <SummaryCard
          label={t("teacherImport.preview.summary.existing")}
          value={preview.plan.summary.existingCount}
        />
        <SummaryCard
          label={t("teacherImport.preview.summary.newClassrooms")}
          value={preview.plan.summary.newHomerooms}
        />
        <SummaryCard
          label={t("teacherImport.preview.summary.errors")}
          value={preview.rowErrors.length}
        />
      </div>

      {preview.skippedBlank > 0 ? (
        <p className="mt-3 text-sm text-white/50">
          {t("teacherImport.preview.skippedBlank", { count: preview.skippedBlank })}
        </p>
      ) : null}

      {hasErrors ? (
        <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-red-100">
              {t("teacherImport.preview.rowsToFix")}
            </h3>
            <a
              href={errorReportHref}
              download="teacher-import-errors.csv"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/30 px-2.5 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/15"
            >
              <Download className="h-3.5 w-3.5" />
              {t("teacherImport.preview.downloadErrors")}
            </a>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-red-100/85">
            {preview.rowErrors.slice(0, 12).map((error) => (
              <li key={`${error.row}-${error.message}`}>
                {t("teacherImport.preview.rowError", {
                  row: error.row,
                  message: error.message,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/45">
              <tr>
                <th className="px-4 py-3">{t("teacherImport.preview.table.status")}</th>
                <th className="px-4 py-3">{t("teacherImport.preview.table.name")}</th>
                <th className="px-4 py-3">{t("teacherImport.preview.table.email")}</th>
                <th className="px-4 py-3">{t("teacherImport.preview.table.homeroom")}</th>
                <th className="px-4 py-3">{t("teacherImport.preview.table.role")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {preview.plan.rows.slice(0, 25).map((row) => (
                <tr key={row.rowNumber} className="text-white/80">
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{row.name}</td>
                  <td className="px-4 py-3 text-white/70">{row.email}</td>
                  <td className="px-4 py-3">
                    {row.homeRoom}
                    {row.homeroomNew ? (
                      <span className="ml-2 text-xs text-emerald-300">
                        {t("teacherImport.preview.table.newTag")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {t(`teacherImport.roles.${row.role}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.plan.rows.length > 25 ? (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
            {t("teacherImport.preview.showingFirstRows", {
              shown: 25,
              total: preview.plan.rows.length,
            })}
          </p>
        ) : null}
      </div>

      {hasErrors ? (
        <label className="mt-4 flex items-center gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={skipInvalid}
            onChange={(event) => setSkipInvalid(event.currentTarget.checked)}
          />
          {t("teacherImport.preview.skipInvalid", {
            count: preview.rowErrors.length,
          })}
        </label>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Form method="post">
          <input type="hidden" name="intent" value="apply" />
          <input type="hidden" name="rowsJson" value={preview.rowsJson} />
          <Button
            type="submit"
            variant="primary"
            isDisabled={!canImport}
            className="w-full sm:w-auto"
          >
            <Mail className="h-4 w-4" />
            {t("teacherImport.preview.invite", {
              count: preview.plan.summary.inviteCount,
            })}
          </Button>
        </Form>
        <Link
          to="/admin/teachers/import"
          className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {t("teacherImport.preview.uploadDifferent")}
        </Link>
      </div>
    </section>
  );
}

export default function AdminTeacherImport({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const { t } = useTranslation("admin");
  const [fileName, setFileName] = useState("");
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-[#152323] via-[#1c2525] to-[#262217] p-6 shadow-2xl shadow-black/30">
        <div className="max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-200/70">
            {t("teacherImport.hero.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            {t("teacherImport.hero.heading")}
          </h1>
          <p className="mt-3 max-w-2xl text-white/65">
            {t("teacherImport.hero.intro")}
          </p>
          <p className="mt-2 text-sm text-white/45">
            {t("teacherImport.hero.currentCount", { count: loaderData.teacherCount })}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-500/15 p-3 text-blue-200">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {t("teacherImport.upload.heading")}
            </h2>
            <p className="mt-1 text-sm text-white/55">
              {t("teacherImport.upload.subtitle")}
            </p>
            <Form
              method="post"
              encType="multipart/form-data"
              className="mt-4 flex flex-col gap-4 md:flex-row md:items-end"
            >
              <input type="hidden" name="intent" value="upload" />
              <label className="flex flex-1 flex-col gap-2 text-sm text-white/65" htmlFor="teacher-file">
                {t("teacherImport.upload.fileLabel")}
                <input
                  id="teacher-file"
                  name="file"
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  required
                  onChange={(event) =>
                    setFileName(event.currentTarget.files?.item(0)?.name ?? "")
                  }
                  className="rounded-xl border border-white/15 bg-[#111616] px-3 py-2 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                />
                {fileName ? (
                  <span className="text-xs text-white/45">
                    {t("teacherImport.upload.selected", { name: fileName })}
                  </span>
                ) : null}
              </label>
              <Button
                type="submit"
                variant="primary"
                isDisabled={isSubmitting}
                isPending={isSubmitting}
              >
                {t("teacherImport.upload.submit")}
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

      {actionData?.stage === "map" ? <MappingPanel map={actionData} /> : null}
      {actionData?.stage === "preview" ? (
        <PreviewPanel preview={actionData} />
      ) : null}
    </div>
  );
}
