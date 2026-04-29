import type { ReactNode } from "react";
import { useState } from "react";
import { Form, Link, redirect } from "react-router";
import { Button, Input, TextArea } from "@heroui/react";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Route } from "./+types/households.$householdId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  DISMISSAL_PLANS,
  WEEKDAYS,
  parseDateOnly,
  parseOptionalDateOnly,
} from "~/domain/dismissal/schedule";
import { loadHouseholdForAdminDetail } from "~/domain/households/household-detail.server";
import { studentDisplayName } from "~/domain/households/households";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import EntityAvatar from "~/components/admin/EntityAvatar";
import StatusPill from "~/components/admin/StatusPill";
import EntityLink from "~/components/admin/EntityLink";
import SectionHeader from "~/components/admin/SectionHeader";

export const handle = { i18n: ["admin", "errors", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Household" },
];

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const DISMISSAL_PLAN_KEYS: Record<string, string> = {
  "Car line": "carLine",
  "Walker": "walker",
  "Bus": "bus",
  "After-school program": "afterSchoolProgram",
  "Office pickup": "officePickup",
  "Other": "other",
};

function dismissalPlanLabel(t: TFunction, plan: string): string {
  const key = DISMISSAL_PLAN_KEYS[plan];
  return key ? t(`households.dismissalPlans.${key}`) : plan;
}

function weekdayLabel(t: TFunction, index: number): string {
  const key = WEEKDAY_KEYS[index];
  return key
    ? t(`households.weekdays.${key}`)
    : t("households.exceptions.scheduleWeeklyFallback");
}

function initialsFromHouseholdName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

function initialsFromPersonName(first: string, last: string): string {
  const a = (first || "").trim().slice(0, 1);
  const b = (last || "").trim().slice(0, 1);
  return `${a}${b}` || "?";
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const id = params.householdId;
  if (!id) {
    throw new Response("Not found", { status: 404 });
  }
  const view = await loadHouseholdForAdminDetail(prisma, {
    householdId: id,
    orgId: org.id,
  });
  if (!view) {
    throw new Response("Not found", { status: 404 });
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    metaTitle: t("households.detail.metaTitle", { name: view.summary.name }),
    view,
  };
}

type LoaderData = Route.ComponentProps["loaderData"];
type ExceptionRow = LoaderData["view"]["sections"]["exceptions"][number];
type StudentRow = LoaderData["view"]["sections"]["students"][number];
type CallEventRow = LoaderData["view"]["sections"]["recentCalls"][number];

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const householdId = params.householdId;
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  if (!householdId) {
    return dataWithError(null, t("households.errors.invalidHousehold"));
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "update") {
      const name = String(formData.get("name") ?? "").trim();
      if (!name) {
        return dataWithError(null, t("households.errors.nameRequired"));
      }
      const spaceRaw = String(formData.get("spaceNumber") ?? "").trim();
      const parsedSpace = spaceRaw ? Number(spaceRaw) : null;
      const spaceNumber =
        parsedSpace != null && Number.isInteger(parsedSpace) && parsedSpace > 0
          ? parsedSpace
          : null;
      await prisma.household.update({
        where: { id: householdId },
        data: {
          name,
          pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
          primaryContactName:
            String(formData.get("primaryContactName") ?? "").trim() || null,
          primaryContactPhone:
            String(formData.get("primaryContactPhone") ?? "").trim() || null,
          spaceNumber,
        },
      });
      return dataWithSuccess(null, t("households.actions.pickupContextUpdated"));
    }

    if (intent === "detach") {
      const studentId = Number(formData.get("studentId"));
      if (!Number.isInteger(studentId)) {
        return dataWithError(null, t("households.errors.invalidStudent"));
      }
      await prisma.student.update({
        where: { id: studentId },
        data: { householdId: null },
      });
      return dataWithWarning(null, t("households.actions.studentDetached"));
    }

    if (intent === "delete") {
      await prisma.student.updateMany({
        where: { householdId },
        data: { householdId: null },
      });
      await prisma.household.delete({ where: { id: householdId } });
      // After delete the household no longer exists — bounce back to the list.
      throw redirect("/admin/households");
    }

    if (intent === "createException") {
      const scheduleKind =
        String(formData.get("scheduleKind") ?? "DATE").toUpperCase() ===
        "WEEKLY"
          ? "WEEKLY"
          : "DATE";
      const dismissalPlan = String(formData.get("dismissalPlan") ?? "").trim();
      if (!dismissalPlan) {
        return dataWithError(
          null,
          t("households.errors.chooseHouseholdAndPlan"),
        );
      }
      let exceptionDate: Date | null = null;
      let dayOfWeek: number | null = null;
      let startsOn: Date | null = null;
      let endsOn: Date | null = null;
      if (scheduleKind === "DATE") {
        exceptionDate = parseDateOnly(
          String(formData.get("exceptionDate") ?? ""),
          "Exception date",
        );
      } else {
        dayOfWeek = Number(formData.get("dayOfWeek"));
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          return dataWithError(null, t("households.errors.chooseWeekday"));
        }
        startsOn = parseOptionalDateOnly(
          String(formData.get("startsOn") ?? ""),
          "Starts on",
        );
        endsOn = parseOptionalDateOnly(
          String(formData.get("endsOn") ?? ""),
          "Ends on",
        );
        if (
          startsOn &&
          endsOn &&
          startsOn.getTime() > endsOn.getTime()
        ) {
          return dataWithError(null, t("households.errors.endsBeforeStart"));
        }
      }

      await prisma.dismissalException.create({
        data: {
          orgId: org.id,
          householdId,
          scheduleKind,
          exceptionDate,
          dayOfWeek,
          startsOn,
          endsOn,
          dismissalPlan,
          pickupContactName:
            String(formData.get("pickupContactName") ?? "").trim() || null,
          notes: String(formData.get("notes") ?? "").trim() || null,
          isActive: true,
        },
      });
      return dataWithSuccess(null, t("households.actions.exceptionSaved"));
    }

    if (intent === "deactivateException") {
      const exceptionId = String(formData.get("exceptionId") ?? "").trim();
      if (!exceptionId) {
        return dataWithError(null, t("households.errors.invalidException"));
      }
      await prisma.dismissalException.update({
        where: { id: exceptionId },
        data: { isActive: false },
      });
      return dataWithWarning(null, t("households.actions.exceptionArchived"));
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("household detail action failed", error);
    return dataWithError(
      null,
      error instanceof Error ? error.message : t("households.errors.updateFailed"),
    );
  }

  return dataWithError(null, t("households.errors.unknown"));
}

export default function AdminHouseholdDetail({
  loaderData,
}: Route.ComponentProps) {
  const { view } = loaderData;
  const { summary, sections } = view;
  const linkedAdmin = sections.linkedAdmin;
  const { t, i18n } = useTranslation("admin");
  const [editing, setEditing] = useState(false);
  const [addingException, setAddingException] = useState(false);

  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const dateTimeFmt = new Intl.DateTimeFormat(i18n.language, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const created = (() => {
    try {
      return dateFmt.format(new Date(summary.createdAtIso));
    } catch {
      return "";
    }
  })();

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-white/50">
        <Link
          to="/admin/households"
          className="inline-flex items-center gap-1 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("households.detail.breadcrumbHouseholds")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-white/80">{summary.name}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <EntityAvatar
            initials={initialsFromHouseholdName(summary.name)}
            colorSeed={summary.id}
            size="xl"
            shape="square"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{summary.name}</h1>
              <StatusPill tone="success">
                {t("households.card.active")}
              </StatusPill>
              {summary.spaceNumber ? (
                <StatusPill tone="cyan">
                  {t("households.detail.header.spaceLabel", {
                    number: summary.spaceNumber,
                  })}
                </StatusPill>
              ) : null}
              {summary.activeTodayCount > 0 ? (
                <StatusPill tone="info">
                  {t("households.list.exceptions", {
                    count: summary.activeTodayCount,
                  }).replace(/^[\s·]+/, "")}
                </StatusPill>
              ) : null}
              {summary.hasMissingContact ? (
                <StatusPill tone="warning">
                  {t("households.stats.missingContact")}
                </StatusPill>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-white/55">
              {t("households.detail.header.studentsLabel", {
                count: summary.studentCount,
              })}
              {" · "}
              {t("households.detail.header.contactsLabel", {
                count: summary.contactCount,
              })}
              {created
                ? ` · ${t("households.detail.header.createdOn", { date: created })}`
                : ""}
            </p>
            {summary.pickupNotes ? (
              <p className="mt-2 text-sm text-white/70 max-w-2xl">
                {summary.pickupNotes}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onPress={() => setAddingException((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {t("households.detail.actions.addException")}
          </Button>
          <Button type="button" variant="secondary" size="sm" isDisabled>
            <MessageSquare className="h-4 w-4" />
            {t("households.detail.actions.message")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onPress={() => setEditing((v) => !v)}
          >
            <Pencil className="h-4 w-4" />
            {t("households.detail.actions.edit")}
          </Button>
        </div>
      </header>

      {/* Inline edit panel */}
      {editing ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <SectionHeader
            title={t("households.detail.edit.heading")}
            subtitle={t("households.detail.edit.subtitle")}
          />
          <Form method="post" className="mt-4 grid gap-3">
            <input type="hidden" name="intent" value="update" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("households.card.nameLabel")}>
                <Input name="name" defaultValue={summary.name} required />
              </Field>
              <Field label={t("households.card.primaryContactLabel")}>
                <Input
                  name="primaryContactName"
                  defaultValue={summary.primaryContactName ?? ""}
                />
              </Field>
              <Field label={t("households.card.contactPhoneLabel")}>
                <Input
                  name="primaryContactPhone"
                  defaultValue={summary.primaryContactPhone ?? ""}
                />
              </Field>
              <Field label={t("households.card.spaceNumberLabel")}>
                <Input
                  name="spaceNumber"
                  type="number"
                  min={1}
                  defaultValue={summary.spaceNumber ?? ""}
                />
              </Field>
            </div>
            <Field label={t("households.card.pickupNotesLabel")}>
              <TextArea
                name="pickupNotes"
                rows={3}
                defaultValue={summary.pickupNotes ?? ""}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" size="sm">
                {t("households.detail.actions.save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => setEditing(false)}
              >
                {t("households.detail.actions.cancel")}
              </Button>
              <Form method="post" className="ml-auto">
                <input type="hidden" name="intent" value="delete" />
                <Button type="submit" variant="danger" size="sm">
                  <Trash2 className="h-4 w-4" />
                  {t("households.detail.actions.delete")}
                </Button>
              </Form>
            </div>
          </Form>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Students */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <SectionHeader
              title={t("households.detail.students.heading")}
              count={summary.studentCount}
              icon={<Users className="h-5 w-5 text-blue-300" />}
            />
            <div className="mt-4">
              {sections.students.length === 0 ? (
                <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45">
                  {t("households.detail.students.empty")}
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {sections.students.map((student) => (
                    <StudentCard
                      key={student.id}
                      student={student}
                      familySpaceNumber={summary.spaceNumber}
                      hasExceptionToday={student.hasExceptionToday}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Contacts */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <SectionHeader
              title={t("households.detail.contacts.heading")}
              count={summary.contactCount}
            />
            <div className="mt-4">
              {!summary.primaryContactName && !summary.primaryContactPhone ? (
                <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45">
                  {t("households.detail.contacts.empty")}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-lg border border-white/8 bg-black/15">
                  <ContactRow
                    name={summary.primaryContactName ?? ""}
                    phone={summary.primaryContactPhone}
                    email={null}
                    isPrimary
                    pickupApproved
                    hasAccount={!!linkedAdmin}
                    linkedAdminId={linkedAdmin?.id ?? null}
                  />
                </ul>
              )}
            </div>
          </section>

          {/* Exceptions */}
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <SectionHeader
              title={t("households.detail.exceptions.heading")}
              count={sections.exceptions.length}
              icon={<CalendarClock className="h-5 w-5 text-cyan-300" />}
              actions={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onPress={() => setAddingException((v) => !v)}
                >
                  <Plus className="h-4 w-4" />
                  {t("households.detail.exceptions.addInline")}
                </Button>
              }
            />

            {addingException ? (
              <div className="mt-4 rounded-xl border border-blue-400/20 bg-blue-400/[0.04] p-4">
                <p className="mb-3 text-sm font-semibold text-white">
                  {t("households.detail.exceptions.newHeading")}
                </p>
                <Form method="post" className="grid gap-3">
                  <input type="hidden" name="intent" value="createException" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t("households.exceptions.scheduleLabel")}>
                      <select
                        name="scheduleKind"
                        className="app-field"
                        defaultValue="DATE"
                      >
                        <option value="DATE">
                          {t("households.exceptions.scheduleDate")}
                        </option>
                        <option value="WEEKLY">
                          {t("households.exceptions.scheduleWeekly")}
                        </option>
                      </select>
                    </Field>
                    <Field label={t("households.exceptions.dismissalPlanLabel")}>
                      <select
                        name="dismissalPlan"
                        className="app-field"
                        defaultValue={DISMISSAL_PLANS[0]}
                      >
                        {DISMISSAL_PLANS.map((plan) => (
                          <option key={plan} value={plan}>
                            {dismissalPlanLabel(t, plan)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("households.exceptions.specificDateLabel")}>
                      <input
                        type="date"
                        name="exceptionDate"
                        className="app-field"
                      />
                    </Field>
                    <Field label={t("households.exceptions.weeklyDayLabel")}>
                      <select
                        name="dayOfWeek"
                        className="app-field"
                        defaultValue="1"
                      >
                        {WEEKDAYS.map((_weekday, index) => (
                          <option key={index} value={index}>
                            {weekdayLabel(t, index)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("households.exceptions.startsOnLabel")}>
                      <input type="date" name="startsOn" className="app-field" />
                    </Field>
                    <Field label={t("households.exceptions.endsOnLabel")}>
                      <input type="date" name="endsOn" className="app-field" />
                    </Field>
                    <Field label={t("households.exceptions.pickupContactLabel")}>
                      <Input
                        name="pickupContactName"
                        placeholder={t(
                          "households.exceptions.pickupContactPlaceholder",
                        )}
                      />
                    </Field>
                  </div>
                  <Field label={t("households.exceptions.notesLabel")}>
                    <TextArea
                      name="notes"
                      rows={3}
                      placeholder={t("households.exceptions.notesPlaceholder")}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Button type="submit" variant="primary" size="sm">
                      {t("households.detail.exceptions.saveNew")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onPress={() => setAddingException(false)}
                    >
                      {t("households.detail.exceptions.cancelNew")}
                    </Button>
                  </div>
                </Form>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              {sections.exceptions.length === 0 ? (
                <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45">
                  {t("households.detail.exceptions.empty")}
                </p>
              ) : (
                sections.exceptions.map((exception) => (
                  <ExceptionCard
                    key={exception.id}
                    exception={exception}
                    students={sections.students}
                    dateFmt={dateFmt}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-blue-400/25 bg-blue-400/[0.08] p-4">
            <p className="text-xs uppercase tracking-wide text-blue-200">
              {t("households.detail.rail.defaultPlanHeading")}
            </p>
            <p className="mt-2 text-sm text-white/85">
              {t("households.detail.rail.defaultPlanBody")}
            </p>
          </div>

          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-4">
            <p className="text-xs uppercase tracking-wide text-amber-200">
              {t("households.detail.rail.pickupNotesHeading")}
            </p>
            <p className="mt-2 text-sm text-white/85 whitespace-pre-wrap">
              {summary.pickupNotes
                ? summary.pickupNotes
                : t("households.detail.rail.pickupNotesEmpty")}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-wide text-white/50">
              {t("households.detail.rail.activityHeading")}
            </p>
            {sections.recentCalls.length === 0 ? (
              <p className="mt-2 text-sm text-white/55">
                {t("households.detail.rail.activityEmpty")}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {sections.recentCalls.map((event: CallEventRow) => (
                  <li
                    key={event.id}
                    className="flex items-center gap-2 text-sm text-white/80"
                  >
                    <EntityAvatar
                      initials={(event.studentName ?? "?")
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join("")}
                      colorSeed={`student:${event.studentId ?? event.studentName}`}
                      size="xs"
                    />
                    <div className="min-w-0">
                      <p className="truncate">{event.studentName}</p>
                      <p className="text-xs text-white/45">
                        {t("households.detail.rail.activityEvent", {
                          space: event.spaceNumber,
                          when: dateTimeFmt.format(new Date(event.createdAtIso)),
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-wide text-white/50">
              {t("households.detail.rail.linkedAdminHeading")}
            </p>
            {linkedAdmin ? (
              <div className="mt-3 flex items-center gap-3">
                <EntityAvatar
                  initials={initialsFromPersonName(
                    linkedAdmin.name.split(/\s+/)[0] ?? "",
                    linkedAdmin.name.split(/\s+/).slice(-1)[0] ?? "",
                  )}
                  colorSeed={`user:${linkedAdmin.id}`}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {linkedAdmin.name}
                  </p>
                  <p className="text-xs text-white/45 truncate">
                    {linkedAdmin.email}
                  </p>
                  <EntityLink
                    to={`/admin/users?selected=${linkedAdmin.id}`}
                    arrow
                  >
                    {t("households.detail.rail.linkedAdminOpen")}
                  </EntityLink>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-white/55">
                {t("households.detail.rail.linkedAdminEmpty")}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function StudentCard({
  student,
  familySpaceNumber,
  hasExceptionToday,
}: {
  student: StudentRow;
  familySpaceNumber: number | null;
  hasExceptionToday: boolean;
}) {
  const { t } = useTranslation("admin");
  return (
    <li className="rounded-xl border border-white/8 bg-black/15 p-4 transition-colors hover:border-white/20">
      <div className="flex items-start gap-3">
        <EntityAvatar
          initials={initialsFromPersonName(student.firstName, student.lastName)}
          colorSeed={`student:${student.id}`}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <EntityLink to={`/admin/students/${student.id}`}>
            {studentDisplayName(student)}
          </EntityLink>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {student.homeRoom ? (
              <StatusPill tone="neutral" size="xs">
                {student.homeRoom}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" size="xs">
                {t("households.detail.students.noTeacher")}
              </StatusPill>
            )}
            {familySpaceNumber ? (
              <StatusPill tone="cyan" size="xs">
                #{familySpaceNumber}
              </StatusPill>
            ) : null}
            {hasExceptionToday ? (
              <StatusPill tone="info" size="xs">
                {t("households.list.exceptions", { count: 1 }).replace(
                  /^[\s·]+/,
                  "",
                )}
              </StatusPill>
            ) : null}
          </div>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="detach" />
          <input type="hidden" name="studentId" value={student.id} />
          <Button type="submit" variant="ghost" size="sm">
            <UserMinus className="h-4 w-4" />
            {t("households.detail.students.detach")}
          </Button>
        </Form>
      </div>
    </li>
  );
}

function ContactRow({
  name,
  phone,
  email,
  isPrimary,
  pickupApproved,
  hasAccount,
  linkedAdminId,
}: {
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary?: boolean;
  pickupApproved?: boolean;
  hasAccount?: boolean;
  linkedAdminId?: string | null;
}) {
  const { t } = useTranslation("admin");
  if (!name && !phone) return null;
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar
          initials={initialsFromPersonName(
            name.split(/\s+/)[0] ?? "",
            name.split(/\s+/).slice(-1)[0] ?? "",
          )}
          colorSeed={`contact:${name}`}
          size="sm"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">
              {name || t("households.detail.contacts.empty")}
            </span>
            {isPrimary ? (
              <StatusPill tone="info" size="xs">
                {t("households.detail.contacts.rolePrimary")}
              </StatusPill>
            ) : null}
            {pickupApproved ? (
              <StatusPill tone="success" size="xs">
                {t("households.detail.contacts.rolePickupApproved")}
              </StatusPill>
            ) : null}
            {hasAccount ? (
              <StatusPill tone="purple" size="xs">
                {t("households.detail.contacts.roleHasAccount")}
              </StatusPill>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/55">
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {email ?? t("households.detail.contacts.noEmail")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {phone ?? t("households.detail.contacts.noPhone")}
            </span>
          </div>
        </div>
      </div>
      {linkedAdminId ? (
        <EntityLink to={`/admin/users?selected=${linkedAdminId}`} arrow>
          {t("households.detail.contacts.viewUser")}
        </EntityLink>
      ) : null}
    </li>
  );
}

function ExceptionCard({
  exception,
  students,
  dateFmt,
}: {
  exception: ExceptionRow;
  students: StudentRow[];
  dateFmt: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation("admin");
  const target =
    exception.studentId
      ? students.find((s) => s.id === exception.studentId)
      : null;
  const targetLabel = target
    ? studentDisplayName(target)
    : t("households.detail.students.heading");

  // Date "tile" — for DATE rows, render the day-of-month; for WEEKLY,
  // render an infinity glyph + weekday abbreviation so the chronology
  // hint is consistent across types.
  let dateTile: ReactNode;
  if (exception.scheduleKind === "DATE" && exception.exceptionDate) {
    const d = new Date(exception.exceptionDate);
    dateTile = (
      <div className="flex flex-col items-center justify-center rounded-lg bg-blue-500/15 px-3 py-2 text-blue-100">
        <span className="text-[10px] uppercase tracking-wide">
          {dateFmt
            .formatToParts(d)
            .find((p) => p.type === "month")?.value ?? ""}
        </span>
        <span className="text-lg font-semibold leading-none">
          {String(d.getUTCDate())}
        </span>
      </div>
    );
  } else {
    const weekdayShort =
      exception.dayOfWeek != null
        ? weekdayLabel(t, exception.dayOfWeek).slice(0, 3)
        : t("households.detail.exceptions.recurringTile");
    dateTile = (
      <div className="flex flex-col items-center justify-center rounded-lg bg-cyan-500/15 px-3 py-2 text-cyan-100">
        <span className="text-base leading-none">∞</span>
        <span className="text-[10px] uppercase tracking-wide mt-0.5">
          {weekdayShort}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between ${
        exception.activeToday
          ? "border-blue-400/30 bg-blue-400/[0.06]"
          : "border-white/10 bg-black/20"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {dateTile}
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">
            {targetLabel} · {dismissalPlanLabel(t, exception.dismissalPlan)}
          </p>
          <p className="text-sm text-cyan-200">
            {formatExceptionSchedule(t, exception)}
            {exception.pickupContactName
              ? ` · ${exception.pickupContactName}`
              : ""}
          </p>
          {exception.notes ? (
            <p className="mt-1 text-sm text-white/65">{exception.notes}</p>
          ) : null}
          <p className="mt-1 text-xs text-white/45">
            {t("households.detail.exceptions.createdBy", {
              date: dateFmt.format(new Date(exception.createdAtIso)),
            })}
          </p>
        </div>
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value="deactivateException" />
        <input type="hidden" name="exceptionId" value={exception.id} />
        <Button type="submit" variant="ghost" size="sm">
          {t("households.exceptions.archive")}
        </Button>
      </Form>
    </div>
  );
}

function formatExceptionSchedule(
  t: TFunction,
  exception: ExceptionRow,
): string {
  if (exception.scheduleKind === "DATE") {
    return exception.exceptionDate
      ? t("households.exceptions.scheduleOneTimeOn", {
          date: exception.exceptionDate,
        })
      : t("households.exceptions.scheduleOneTime");
  }

  const weekday =
    exception.dayOfWeek != null
      ? weekdayLabel(t, exception.dayOfWeek)
      : t("households.exceptions.scheduleWeeklyFallback");
  const startsOn = exception.startsOn
    ? t("households.exceptions.scheduleStartsOn", { date: exception.startsOn })
    : "";
  const endsOn = exception.endsOn
    ? t("households.exceptions.scheduleEndsOn", { date: exception.endsOn })
    : "";
  return `${weekday}${startsOn}${endsOn}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/60">
      <span>{label}</span>
      {children}
    </label>
  );
}
