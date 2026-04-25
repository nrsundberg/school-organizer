import type { ReactNode } from "react";
import { Form } from "react-router";
import { Button, Input, TextArea } from "@heroui/react";
import { CalendarClock, Home, Megaphone, TrendingUp, UserMinus, Users } from "lucide-react";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Route } from "./+types/households";
import {
  defaultHouseholdName,
  parseStudentIds,
  studentDisplayName,
} from "~/domain/households/households";
import {
  DISMISSAL_PLANS,
  WEEKDAYS,
  dateRangeFromSearchParams,
  parseDateOnly,
  parseOptionalDateOnly,
  toDateInputValue,
} from "~/domain/dismissal/schedule";
import { buildRoiDashboardSnapshot } from "~/domain/dismissal/roi.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { broadcastProgramCancellation } from "~/lib/broadcast.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";

export const handle = { i18n: ["admin", "errors", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Households" },
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
  return key ? t(`households.weekdays.${key}`) : t("households.exceptions.scheduleWeeklyFallback");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const roiRange = dateRangeFromSearchParams(new URL(request.url));
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  const [
    households,
    unassignedStudents,
    allStudents,
    roi,
    activeExceptions,
    programs,
    recentCancellations,
  ] = await Promise.all([
    prisma.household.findMany({
      orderBy: { name: "asc" },
      include: {
        students: {
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            homeRoom: true,
            spaceNumber: true,
          },
        },
        exceptions: {
          where: { isActive: true },
          orderBy: [
            { scheduleKind: "asc" },
            { exceptionDate: "asc" },
            { createdAt: "desc" },
          ],
          select: {
            id: true,
            dismissalPlan: true,
            scheduleKind: true,
          },
        },
      },
    }),
    prisma.student.findMany({
      where: { householdId: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        homeRoom: true,
        spaceNumber: true,
      },
    }),
    prisma.student.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        householdId: true,
      },
    }),
    buildRoiDashboardSnapshot(prisma, roiRange),
    prisma.dismissalException.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        scheduleKind: true,
        exceptionDate: true,
        dayOfWeek: true,
        startsOn: true,
        endsOn: true,
        dismissalPlan: true,
        pickupContactName: true,
        notes: true,
        household: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.afterSchoolProgram.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.programCancellation.findMany({
      orderBy: [{ cancellationDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: {
        program: { select: { name: true } },
      },
    }),
  ]);

  return {
    metaTitle: t("households.metaTitle"),
    households,
    unassignedStudents,
    allStudents,
    roi,
    activeExceptions: activeExceptions.map((exception) => ({
      ...exception,
      exceptionDate: toDateInputValue(exception.exceptionDate),
      startsOn: toDateInputValue(exception.startsOn),
      endsOn: toDateInputValue(exception.endsOn),
    })),
    programs,
    recentCancellations: recentCancellations.map((cancellation) => ({
      id: cancellation.id,
      programId: cancellation.programId,
      programName: cancellation.program.name,
      cancellationDate: toDateInputValue(cancellation.cancellationDate),
      title: cancellation.title,
      message: cancellation.message,
    })),
  };
}

type LoaderData = Route.ComponentProps["loaderData"];
type HouseholdRecord = LoaderData["households"][number];
type ExceptionRecord = LoaderData["activeExceptions"][number];
type CancellationRecord = LoaderData["recentCancellations"][number];
type StudentListRecord = {
  id: number;
  firstName: string;
  lastName: string;
  homeRoom?: string | null;
  spaceNumber?: number | null;
  householdId?: string | null;
};

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  try {
    if (intent === "create") {
      const studentIds = parseStudentIds(formData);
      if (studentIds.length === 0) {
        return dataWithError(null, t("households.errors.chooseStudent"));
      }

      const students = await prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      if (students.length === 0) {
        return dataWithError(null, t("households.errors.noMatchingStudents"));
      }

      const requestedName = String(formData.get("name") ?? "").trim();
      const household = await prisma.household.create({
        data: {
          orgId: org.id,
          name: requestedName || defaultHouseholdName(students),
          pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
          primaryContactName:
            String(formData.get("primaryContactName") ?? "").trim() || null,
          primaryContactPhone:
            String(formData.get("primaryContactPhone") ?? "").trim() || null,
        },
      });

      await prisma.student.updateMany({
        where: { id: { in: students.map((student) => student.id) } },
        data: { householdId: household.id },
      });

      return dataWithSuccess(
        null,
        t("households.actions.createdHousehold", { name: household.name }),
      );
    }

    if (intent === "update") {
      const householdId = String(formData.get("householdId") ?? "");
      const name = String(formData.get("name") ?? "").trim();
      if (!householdId || !name) {
        return dataWithError(null, t("households.errors.nameRequired"));
      }

      await prisma.household.update({
        where: { id: householdId },
        data: {
          name,
          pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
          primaryContactName:
            String(formData.get("primaryContactName") ?? "").trim() || null,
          primaryContactPhone:
            String(formData.get("primaryContactPhone") ?? "").trim() || null,
        },
      });
      return dataWithSuccess(null, t("households.actions.pickupContextUpdated"));
    }

    if (intent === "assign") {
      const householdId = String(formData.get("householdId") ?? "");
      const studentIds = parseStudentIds(formData);
      if (!householdId || studentIds.length === 0) {
        return dataWithError(
          null,
          t("households.errors.chooseHouseholdAndStudent"),
        );
      }

      await prisma.student.updateMany({
        where: { id: { in: studentIds } },
        data: { householdId },
      });
      return dataWithSuccess(null, t("households.actions.studentAssignmentUpdated"));
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
      const householdId = String(formData.get("householdId") ?? "");
      if (!householdId) {
        return dataWithError(null, t("households.errors.invalidHousehold"));
      }

      await prisma.student.updateMany({
        where: { householdId },
        data: { householdId: null },
      });
      await prisma.household.delete({ where: { id: householdId } });
      return dataWithWarning(
        null,
        t("households.actions.householdDeleted"),
      );
    }

    if (intent === "createException") {
      const householdId = String(formData.get("householdId") ?? "").trim();
      const scheduleKind =
        String(formData.get("scheduleKind") ?? "DATE").toUpperCase() ===
        "WEEKLY"
          ? "WEEKLY"
          : "DATE";
      const dismissalPlan = String(formData.get("dismissalPlan") ?? "").trim();

      if (!householdId || !dismissalPlan) {
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

    if (intent === "createCancellation") {
      const programId = String(formData.get("programId") ?? "").trim();
      const programNameInput = String(formData.get("programName") ?? "").trim();
      const cancellationDate = parseDateOnly(
        String(formData.get("cancellationDate") ?? ""),
        "Cancellation date",
      );
      const title = String(formData.get("title") ?? "").trim();
      const message = String(formData.get("message") ?? "").trim();

      if (!programId && !programNameInput) {
        return dataWithError(
          null,
          t("households.errors.chooseProgram"),
        );
      }
      if (!title || !message) {
        return dataWithError(
          null,
          t("households.errors.titleAndMessageRequired"),
        );
      }

      let program =
        programId.length > 0
          ? await prisma.afterSchoolProgram.findUnique({
              where: { id: programId },
              select: { id: true, name: true },
            })
          : null;

      if (!program && programNameInput) {
        program = await prisma.afterSchoolProgram.findFirst({
          where: { name: programNameInput },
          select: { id: true, name: true },
        });
      }

      if (!program && programNameInput) {
        program = await prisma.afterSchoolProgram.create({
          data: {
            orgId: org.id,
            name: programNameInput,
            isActive: true,
          },
          select: { id: true, name: true },
        });
      }

      if (!program) {
        return dataWithError(null, t("households.errors.unableResolveProgram"));
      }

      const cancellation = await prisma.programCancellation.create({
        data: {
          orgId: org.id,
          programId: program.id,
          cancellationDate,
          title,
          message,
          deliveryMode: "IN_APP",
        },
        select: {
          id: true,
          cancellationDate: true,
        },
      });

      const env = (context as { cloudflare?: { env?: Env } }).cloudflare?.env;
      if (env) {
        try {
          await broadcastProgramCancellation(env, {
            id: cancellation.id,
            programName: program.name,
            cancellationDate: toDateInputValue(cancellation.cancellationDate),
            title,
            message,
          });
        } catch (error) {
          console.error("program cancellation broadcast failed", error);
          return dataWithWarning(
            null,
            t("households.actions.cancellationBroadcastFailed"),
          );
        }
      }

      return dataWithSuccess(
        null,
        t("households.actions.cancellationSent", { name: program.name }),
      );
    }
  } catch (error) {
    console.error("household action failed", error);
    return dataWithError(
      null,
      error instanceof Error ? error.message : t("households.errors.updateFailed"),
    );
  }

  return dataWithError(null, t("households.errors.unknown"));
}

export default function AdminHouseholds({ loaderData }: Route.ComponentProps) {
  const {
    households,
    unassignedStudents,
    allStudents,
    roi,
    activeExceptions,
    programs,
    recentCancellations,
  } = loaderData;
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t("households.heading")}
          </h1>
          <p className="max-w-3xl text-sm text-white/60">
            {t("households.intro")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="#roi"
            className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:border-white/30 hover:text-white"
          >
            {t("households.anchors.roi")}
          </a>
          <a
            href="#exceptions"
            className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:border-white/30 hover:text-white"
          >
            {t("households.anchors.exceptions")}
          </a>
          <a
            href="#cancellations"
            className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:border-white/30 hover:text-white"
          >
            {t("households.anchors.cancellations")}
          </a>
        </div>
      </div>

      <RoiPanel roi={roi} />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-300" />
            <h2 className="font-semibold text-white">
              {t("households.create.heading")}
            </h2>
          </div>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="create" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("households.create.nameLabel")}>
                <Input
                  name="name"
                  placeholder={t("households.create.namePlaceholder")}
                />
              </Field>
              <Field label={t("households.create.primaryContactLabel")}>
                <Input
                  name="primaryContactName"
                  placeholder={t("households.create.primaryContactPlaceholder")}
                />
              </Field>
              <Field label={t("households.create.contactPhoneLabel")}>
                <Input
                  name="primaryContactPhone"
                  placeholder={t("households.create.contactPhonePlaceholder")}
                />
              </Field>
            </div>
            <Field label={t("households.create.pickupContextLabel")}>
              <TextArea
                name="pickupNotes"
                rows={3}
                placeholder={t("households.create.pickupContextPlaceholder")}
              />
            </Field>
            <StudentCheckboxList
              students={unassignedStudents}
              emptyText={t("households.create.unassignedEmpty")}
            />
            <Button type="submit" variant="primary" className="self-start">
              {t("households.create.submit")}
            </Button>
          </Form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-semibold text-white">
            {t("households.assign.heading")}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {t("households.assign.subtitle")}
          </p>
          <Form method="post" className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="intent" value="assign" />
            <Field label={t("households.assign.householdLabel")}>
              <select
                name="householdId"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                defaultValue=""
              >
                <option value="">
                  {t("households.assign.householdPlaceholder")}
                </option>
                {households.map((household: HouseholdRecord) => (
                  <option key={household.id} value={household.id}>
                    {household.name}
                  </option>
                ))}
              </select>
            </Field>
            <StudentCheckboxList
              students={allStudents}
              emptyText={t("households.assign.noStudents")}
              compact
            />
            <Button type="submit" variant="secondary">
              {t("households.assign.submit")}
            </Button>
          </Form>
        </div>
      </section>

      <section
        id="exceptions"
        className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
      >
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-cyan-300" />
            <h2 className="font-semibold text-white">
              {t("households.exceptions.addHeading")}
            </h2>
          </div>
          <p className="mb-4 text-sm text-white/50">
            {t("households.exceptions.addIntro")}
          </p>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="intent" value="createException" />
            <Field label={t("households.exceptions.householdLabel")}>
              <select
                name="householdId"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                defaultValue=""
                required
              >
                <option value="">
                  {t("households.exceptions.householdPlaceholder")}
                </option>
                {households.map((household: HouseholdRecord) => (
                  <option key={household.id} value={household.id}>
                    {household.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("households.exceptions.scheduleLabel")}>
                <select
                  name="scheduleKind"
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
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
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
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
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label={t("households.exceptions.weeklyDayLabel")}>
                <select
                  name="dayOfWeek"
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
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
                <input
                  type="date"
                  name="startsOn"
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label={t("households.exceptions.endsOnLabel")}>
                <input
                  type="date"
                  name="endsOn"
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label={t("households.exceptions.pickupContactLabel")}>
                <Input
                  name="pickupContactName"
                  placeholder={t("households.exceptions.pickupContactPlaceholder")}
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
            <Button type="submit" variant="secondary" className="self-start">
              {t("households.exceptions.saveException")}
            </Button>
          </Form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-semibold text-white">
            {t("households.exceptions.activeHeading")}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {t("households.exceptions.activeSubtitle")}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {activeExceptions.length === 0 ? (
              <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45">
                {t("households.exceptions.noneActive")}
              </p>
            ) : (
              activeExceptions.map((exception: ExceptionRecord) => (
                <div
                  key={exception.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-white">
                        {exception.household?.name ??
                          t("households.exceptions.deletedHousehold")}
                      </p>
                      <p className="text-sm text-cyan-200">
                        {formatExceptionSchedule(t, exception)}
                      </p>
                      <p className="mt-1 text-sm text-white/70">
                        {dismissalPlanLabel(t, exception.dismissalPlan)}
                        {exception.pickupContactName
                          ? ` · ${exception.pickupContactName}`
                          : ""}
                      </p>
                      {exception.notes ? (
                        <p className="mt-1 text-sm text-white/55">
                          {exception.notes}
                        </p>
                      ) : null}
                    </div>
                    <Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value="deactivateException"
                      />
                      <input
                        type="hidden"
                        name="exceptionId"
                        value={exception.id}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {t("households.exceptions.archive")}
                      </Button>
                    </Form>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section
        id="cancellations"
        className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
      >
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-amber-300" />
            <h2 className="font-semibold text-white">
              {t("households.cancellations.broadcastHeading")}
            </h2>
          </div>
          <p className="mb-4 text-sm text-white/50">
            {t("households.cancellations.broadcastIntro")}
          </p>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="intent" value="createCancellation" />
            <Field label={t("households.cancellations.existingProgramLabel")}>
              <select
                name="programId"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                defaultValue=""
              >
                <option value="">
                  {t("households.cancellations.existingProgramPlaceholder")}
                </option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("households.cancellations.programNameLabel")}>
              <Input
                name="programName"
                placeholder={t("households.cancellations.programNamePlaceholder")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("households.cancellations.cancellationDateLabel")}>
                <input
                  type="date"
                  name="cancellationDate"
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                  required
                />
              </Field>
              <Field label={t("households.cancellations.alertTitleLabel")}>
                <Input
                  name="title"
                  placeholder={t("households.cancellations.alertTitlePlaceholder")}
                  required
                />
              </Field>
            </div>
            <Field label={t("households.cancellations.messageLabel")}>
              <TextArea
                name="message"
                rows={3}
                placeholder={t("households.cancellations.messagePlaceholder")}
              />
            </Field>
            <Button type="submit" variant="secondary" className="self-start">
              {t("households.cancellations.submit")}
            </Button>
          </Form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-semibold text-white">
            {t("households.cancellations.recentHeading")}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {t("households.cancellations.recentSubtitle")}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {recentCancellations.length === 0 ? (
              <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45">
                {t("households.cancellations.noneRecent")}
              </p>
            ) : (
              recentCancellations.map((notice: CancellationRecord) => (
                <div
                  key={notice.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <p className="font-semibold text-white">{notice.title}</p>
                  <p className="text-sm text-amber-200">
                    {notice.programName} · {notice.cancellationDate}
                  </p>
                  <p className="mt-1 text-sm text-white/70">{notice.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {households.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
            {t("households.list.empty")}
          </div>
        ) : (
          households.map((household: HouseholdRecord) => (
            <HouseholdCard key={household.id} household={household} />
          ))
        )}
      </section>
    </div>
  );
}

function RoiPanel({ roi }: { roi: LoaderData["roi"] }) {
  const { t } = useTranslation("admin");
  return (
    <section
      id="roi"
      className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-200">
            <TrendingUp className="h-4 w-4" />
            {t("households.roi.eyebrow")}
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {t("households.roi.summary", {
              calls: roi.avoidedCalls.total,
              minutes: roi.minutesSaved,
            })}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-white/70">
            {t("households.roi.rangeNote", {
              from: roi.range.from,
              to: roi.range.to,
            })}
          </p>
        </div>
        <Form method="get" className="grid gap-3 sm:grid-cols-3">
          <Field label={t("households.roi.fromLabel")}>
            <input
              type="date"
              name="from"
              defaultValue={roi.range.from}
              className="rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </Field>
          <Field label={t("households.roi.toLabel")}>
            <input
              type="date"
              name="to"
              defaultValue={roi.range.to}
              className="rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm text-white"
            />
          </Field>
          <Button type="submit" variant="secondary" className="self-end">
            {t("households.roi.refresh")}
          </Button>
        </Form>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <RoiMetric
          label={t("households.roi.metrics.householdGroups")}
          value={String(roi.householdGroups)}
          detail={t("households.roi.metrics.householdGroupsDetail", {
            count: roi.householdSiblingSlots,
          })}
        />
        <RoiMetric
          label={t("households.roi.metrics.recurringExceptions")}
          value={String(roi.exceptionOccurrences)}
          detail={t("households.roi.metrics.recurringExceptionsDetail", {
            count: roi.avoidedCalls.exceptions,
          })}
        />
        <RoiMetric
          label={t("households.roi.metrics.programCancellations")}
          value={String(roi.programCancellations)}
          detail={t("households.roi.metrics.programCancellationsDetail", {
            count: roi.avoidedCalls.cancellations,
          })}
        />
        <RoiMetric
          label={t("households.roi.metrics.pickupDaysWithCalls")}
          value={String(roi.pickupDaysWithCalls)}
          detail={t("households.roi.metrics.pickupDaysWithCallsDetail", {
            count: roi.baselineCalls,
          })}
        />
      </div>

      <p className="mt-4 text-xs text-white/60">
        {t("households.roi.assumptions", {
          minutes: roi.assumptions.minutesPerAvoidedCall,
          exceptions: roi.assumptions.callsAvoidedPerExceptionOccurrence,
          cancellations: roi.assumptions.callsAvoidedPerProgramCancellation,
        })}
      </p>
    </section>
  );
}

function RoiMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-white/60">{detail}</p>
    </div>
  );
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

function StudentCheckboxList({
  students,
  emptyText,
  compact = false,
}: {
  students: StudentListRecord[];
  emptyText: string;
  compact?: boolean;
}) {
  const { t } = useTranslation("admin");
  if (students.length === 0) {
    return (
      <p className="rounded-lg bg-black/20 p-3 text-sm text-white/45">
        {emptyText}
      </p>
    );
  }

  return (
    <div
      className={`grid gap-2 ${
        compact ? "max-h-56 overflow-y-auto" : "sm:grid-cols-2"
      }`}
    >
      {students.map((student) => (
        <label
          key={student.id}
          className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white"
        >
          <input type="checkbox" name="studentIds" value={student.id} className="mt-1" />
          <span>
            <span className="font-medium">{studentDisplayName(student)}</span>
            <span className="block text-xs text-white/45">
              {student.homeRoom
                ? t("households.studentList.homeroomSeparator", {
                    homeRoom: student.homeRoom,
                  })
                : ""}
              {student.spaceNumber
                ? t("households.studentList.spaceLabel", {
                    number: student.spaceNumber,
                  })
                : t("households.studentList.noSpace")}
              {student.householdId
                ? t("households.studentList.currentlyGrouped")
                : ""}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function HouseholdCard({ household }: { household: HouseholdRecord }) {
  const { t } = useTranslation("admin");
  const studentCount = household.students.length;
  const exceptionCount = household.exceptions.length;
  return (
    <article className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Home className="h-5 w-5 text-blue-300" />
            <h2 className="text-lg font-semibold text-white">{household.name}</h2>
          </div>
          <p className="mt-1 text-sm text-white/50">
            {t("households.list.students", { count: studentCount })}
            {exceptionCount > 0
              ? t("households.list.exceptions", { count: exceptionCount })
              : ""}
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="householdId" value={household.id} />
          <Button type="submit" variant="danger" size="sm">
            {t("households.list.delete")}
          </Button>
        </Form>
      </div>

      <Form method="post" className="mb-5 grid gap-3">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="householdId" value={household.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("households.card.nameLabel")}>
            <Input name="name" defaultValue={household.name} required />
          </Field>
          <Field label={t("households.card.primaryContactLabel")}>
            <Input
              name="primaryContactName"
              defaultValue={household.primaryContactName ?? ""}
            />
          </Field>
          <Field label={t("households.card.contactPhoneLabel")}>
            <Input
              name="primaryContactPhone"
              defaultValue={household.primaryContactPhone ?? ""}
            />
          </Field>
        </div>
        <Field label={t("households.card.pickupNotesLabel")}>
          <TextArea
            name="pickupNotes"
            rows={3}
            defaultValue={household.pickupNotes ?? ""}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          className="justify-self-start"
        >
          {t("households.list.savePickupContext")}
        </Button>
      </Form>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {household.students.length === 0 ? (
          <p className="p-4 text-sm text-white/45">
            {t("households.list.noStudentsAssigned")}
          </p>
        ) : (
          household.students.map((student) => (
            <div
              key={student.id}
              className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-3 first:border-t-0"
            >
              <div>
                <p className="font-medium text-white">
                  {studentDisplayName(student)}
                </p>
                <p className="text-xs text-white/45">
                  {student.homeRoom ?? t("households.list.noHomeroom")} ·{" "}
                  {student.spaceNumber
                    ? t("households.list.spaceLabel", {
                        number: student.spaceNumber,
                      })
                    : t("households.list.noSpace")}
                </p>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="detach" />
                <input type="hidden" name="studentId" value={student.id} />
                <Button type="submit" variant="ghost" size="sm">
                  <UserMinus className="h-4 w-4" />
                  {t("households.list.detach")}
                </Button>
              </Form>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function formatExceptionSchedule(
  t: TFunction,
  exception: ExceptionRecord,
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
