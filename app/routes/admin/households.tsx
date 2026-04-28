import type { ReactNode } from "react";
import { useState } from "react";
import { Form, Link } from "react-router";
import { Button, Input, TextArea } from "@heroui/react";
import {
  CalendarClock,
  Home,
  Megaphone,
  Plus,
  Search,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
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
  dateRangeFromSearchParams,
  parseDateOnly,
  parseOptionalDateOnly,
  toDateInputValue,
} from "~/domain/dismissal/schedule";
import { buildRoiDashboardSnapshot } from "~/domain/dismissal/roi.server";
import { chunk, chunkedFindMany, groupBy } from "~/db/chunked-in";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { broadcastProgramCancellation } from "~/lib/broadcast.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import EntityAvatar from "~/components/admin/EntityAvatar";
import StatusPill from "~/components/admin/StatusPill";
import EntityLink from "~/components/admin/EntityLink";
import StatCard from "~/components/admin/StatCard";
import SectionHeader from "~/components/admin/SectionHeader";

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

const HOUSEHOLDS_PAGE_SIZE = 50;

/**
 * Active filter pill values. Encoded into the URL as `?filter=…` so admins
 * can deep-link a saved view (e.g. "show only households missing a primary
 * contact") and so server-side counts stay consistent across reloads.
 */
const FILTER_VALUES = [
  "all",
  "exceptionToday",
  "missingContact",
  "singleParent",
  "multiStudent",
] as const;
type FilterValue = (typeof FILTER_VALUES)[number];

function parseFilter(raw: string | null): FilterValue {
  if (!raw) return "all";
  return (FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as FilterValue)
    : "all";
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

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Returns true if the given exception is "active today" — either a DATE row
 * matching today's UTC day or a WEEKLY row whose `dayOfWeek` matches today
 * and whose optional starts/ends window contains today.
 */
function exceptionActiveOn(
  exception: {
    scheduleKind: string;
    exceptionDate: Date | null;
    dayOfWeek: number | null;
    startsOn: Date | null;
    endsOn: Date | null;
  },
  today: Date,
): boolean {
  const dayStart = startOfUtcDay(today);
  if (exception.scheduleKind === "DATE") {
    if (!exception.exceptionDate) return false;
    return startOfUtcDay(exception.exceptionDate).getTime() === dayStart.getTime();
  }
  if (exception.dayOfWeek == null) return false;
  if (today.getUTCDay() !== exception.dayOfWeek) return false;
  if (exception.startsOn && dayStart.getTime() < startOfUtcDay(exception.startsOn).getTime()) {
    return false;
  }
  if (exception.endsOn && dayStart.getTime() > startOfUtcDay(exception.endsOn).getTime()) {
    return false;
  }
  return true;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const url = new URL(request.url);
  const roiRange = dateRangeFromSearchParams(url);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  // Pagination + name search. Schools can grow into the hundreds of
  // households; loading them all on one page is both slow and unusable.
  const searchQuery = (url.searchParams.get("q") ?? "").trim();
  const filter = parseFilter(url.searchParams.get("filter"));
  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const page =
    Number.isFinite(requestedPage) && requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;
  const householdSearchWhere = searchQuery
    ? { name: { contains: searchQuery } }
    : {};

  // Avoid Prisma `include` on Household's children: with N households
  // Prisma fans out into `WHERE householdId IN (?, …N…)` which overflows
  // D1's bound-parameter cap once N grows past ~500. Same trap on the
  // `activeExceptions` → household join below. Fetch parents and
  // children separately, chunk the IN list, stitch in JS.
  const [
    households,
    totalHouseholds,
    householdOptions,
    unassignedStudents,
    allStudents,
    roi,
    activeExceptionsRaw,
    programs,
    recentCancellations,
    studentsAssignedCount,
    allActiveExceptions,
  ] = await Promise.all([
    prisma.household.findMany({
      where: householdSearchWhere,
      orderBy: { name: "asc" },
      skip: (page - 1) * HOUSEHOLDS_PAGE_SIZE,
      take: HOUSEHOLDS_PAGE_SIZE,
    }),
    prisma.household.count({ where: householdSearchWhere }),
    prisma.household.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.student.findMany({
      where: { householdId: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        homeRoom: true,
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
        householdId: true,
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
    prisma.student.count({ where: { householdId: { not: null } } }),
    // Org-wide active exceptions; used to compute "households with active
    // exceptions today" for the stats row regardless of pagination.
    prisma.dismissalException.findMany({
      where: { isActive: true },
      select: {
        scheduleKind: true,
        exceptionDate: true,
        dayOfWeek: true,
        startsOn: true,
        endsOn: true,
        householdId: true,
      },
    }),
  ]);

  type HouseholdStudentRow = {
    id: number;
    firstName: string;
    lastName: string;
    homeRoom: string | null;
    householdId: string | null;
  };
  type HouseholdExceptionRow = {
    id: string;
    dismissalPlan: string;
    scheduleKind: string;
    exceptionDate: Date | null;
    dayOfWeek: number | null;
    startsOn: Date | null;
    endsOn: Date | null;
    householdId: string | null;
  };
  type HouseholdRefRow = { id: string; name: string };
  type ActiveExceptionRaw = (typeof activeExceptionsRaw)[number];

  const householdIds: string[] = households.map(
    (household: { id: string }) => household.id,
  );
  const exceptionHouseholdIds: string[] = Array.from(
    new Set(
      activeExceptionsRaw
        .map((exception: ActiveExceptionRaw) =>
          exception.householdId as string | null,
        )
        .filter((id: string | null): id is string => typeof id === "string"),
    ),
  );

  const [householdStudents, householdExceptions, exceptionHouseholds] =
    await Promise.all([
      chunkedFindMany<string, HouseholdStudentRow>(householdIds, (idChunk) =>
        prisma.student.findMany({
          where: { householdId: { in: idChunk } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            homeRoom: true,
            householdId: true,
          },
        }) as Promise<HouseholdStudentRow[]>,
      ),
      chunkedFindMany<string, HouseholdExceptionRow>(householdIds, (idChunk) =>
        prisma.dismissalException.findMany({
          where: { householdId: { in: idChunk }, isActive: true },
          orderBy: [
            { scheduleKind: "asc" },
            { exceptionDate: "asc" },
            { createdAt: "desc" },
          ],
          select: {
            id: true,
            dismissalPlan: true,
            scheduleKind: true,
            exceptionDate: true,
            dayOfWeek: true,
            startsOn: true,
            endsOn: true,
            householdId: true,
          },
        }) as Promise<HouseholdExceptionRow[]>,
      ),
      chunkedFindMany<string, HouseholdRefRow>(exceptionHouseholdIds, (idChunk) =>
        prisma.household.findMany({
          where: { id: { in: idChunk } },
          select: { id: true, name: true },
        }) as Promise<HouseholdRefRow[]>,
      ),
    ]);

  const studentsByHousehold = groupBy(
    householdStudents,
    (student) => student.householdId ?? "",
  );
  const exceptionsByHousehold = groupBy(
    householdExceptions,
    (exception) => exception.householdId ?? "",
  );
  const householdLookup = new Map(
    exceptionHouseholds.map((household) => [household.id, household] as const),
  );

  const today = new Date();
  const householdsWithExceptionsTodaySet = new Set(
    allActiveExceptions
      .filter((e) => e.householdId && exceptionActiveOn(e, today))
      .map((e) => e.householdId as string),
  );

  // Map only the trimmed shapes the index needs; we keep the full
  // exception fields available so the card can render "exception today"
  // pills accurately.
  const householdsWithChildren = households.map((household) => {
    const students = (studentsByHousehold.get(household.id) ?? []).map(
      ({ householdId: _ignored, ...student }) => student,
    );
    const exceptions = (exceptionsByHousehold.get(household.id) ?? []).map(
      ({ householdId: _ignored, ...exception }) => ({
        ...exception,
        exceptionDate: toDateInputValue(exception.exceptionDate),
        startsOn: toDateInputValue(exception.startsOn),
        endsOn: toDateInputValue(exception.endsOn),
      }),
    );
    const exceptionTodayCount = (exceptionsByHousehold.get(household.id) ?? [])
      .filter((e) => exceptionActiveOn(e, today)).length;
    return {
      ...household,
      createdAt:
        household.createdAt instanceof Date
          ? household.createdAt.toISOString()
          : (household.createdAt as unknown as string),
      students,
      exceptions,
      exceptionTodayCount,
    };
  });

  // Apply client-readable filter pills server-side so deep-linked URLs
  // reflect the same dataset the user sees.
  const filteredHouseholds = householdsWithChildren.filter((household) => {
    if (filter === "exceptionToday") return household.exceptionTodayCount > 0;
    if (filter === "missingContact")
      return !household.primaryContactName?.trim() || !household.primaryContactPhone?.trim();
    if (filter === "singleParent") {
      // Best-effort heuristic — we only store a single primary contact
      // today, so "single-parent" reduces to "exactly one named contact".
      return !!household.primaryContactName?.trim();
    }
    if (filter === "multiStudent") return household.students.length >= 2;
    return true;
  });

  const activeExceptions = activeExceptionsRaw.map(
    ({ householdId, ...exception }: ActiveExceptionRaw) => ({
      ...exception,
      household: householdId ? householdLookup.get(householdId) ?? null : null,
    }),
  );

  // Stats row aggregates — totals are org-wide (not paginated).
  const householdsMissingContactCount = await prisma.household.count({
    where: {
      OR: [
        { primaryContactName: null },
        { primaryContactName: "" },
        { primaryContactPhone: null },
        { primaryContactPhone: "" },
      ],
    },
  });

  const totalPages = Math.max(
    1,
    Math.ceil(filteredHouseholds.length === householdsWithChildren.length
      ? totalHouseholds / HOUSEHOLDS_PAGE_SIZE
      : filteredHouseholds.length / HOUSEHOLDS_PAGE_SIZE),
  );
  return {
    metaTitle: t("households.metaTitle"),
    households: filteredHouseholds,
    householdOptions,
    pagination: {
      page,
      pageSize: HOUSEHOLDS_PAGE_SIZE,
      totalHouseholds,
      totalPages,
      searchQuery,
      filter,
    },
    stats: {
      totalHouseholds,
      studentsAssigned: studentsAssignedCount,
      householdsWithExceptionsToday: householdsWithExceptionsTodaySet.size,
      householdsMissingContact: householdsMissingContactCount,
    },
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

      type StudentRow = { id: number; firstName: string; lastName: string };
      const students = await chunkedFindMany<number, StudentRow>(
        studentIds,
        (idChunk) =>
          prisma.student.findMany({
            where: { id: { in: idChunk } },
            select: { id: true, firstName: true, lastName: true },
          }) as Promise<StudentRow[]>,
      );
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

      for (const idChunk of chunk(students.map((student) => student.id))) {
        await prisma.student.updateMany({
          where: { id: { in: idChunk } },
          data: { householdId: household.id },
        });
      }

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

      for (const idChunk of chunk(studentIds)) {
        await prisma.student.updateMany({
          where: { id: { in: idChunk } },
          data: { householdId },
        });
      }
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
    householdOptions,
    pagination,
    unassignedStudents,
    allStudents,
    roi,
    activeExceptions,
    programs,
    recentCancellations,
    stats,
  } = loaderData;
  const { t, i18n } = useTranslation("admin");
  const [createOpen, setCreateOpen] = useState(false);

  const dateFmt = new Intl.DateTimeFormat(i18n.language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t("households.indexHeader.title")}
          </h1>
          <p className="max-w-3xl text-sm text-white/60">
            {t("households.indexHeader.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onPress={() => setCreateOpen((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {t("households.indexHeader.createCta")}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("households.stats.totalHouseholds")}
          value={stats.totalHouseholds}
          caption={t("households.stats.totalHouseholdsCaption")}
          icon={<Home className="h-4 w-4 text-blue-300" />}
        />
        <StatCard
          label={t("households.stats.studentsAssigned")}
          value={stats.studentsAssigned}
          caption={t("households.stats.studentsAssignedCaption")}
          icon={<Users className="h-4 w-4 text-cyan-300" />}
        />
        <StatCard
          label={t("households.stats.exceptionsToday")}
          value={stats.householdsWithExceptionsToday}
          caption={t("households.stats.exceptionsTodayCaption")}
          icon={<CalendarClock className="h-4 w-4 text-purple-300" />}
          tone={stats.householdsWithExceptionsToday > 0 ? "info" : "default"}
        />
        <StatCard
          label={t("households.stats.missingContact")}
          value={stats.householdsMissingContact}
          caption={t("households.stats.missingContactCaption")}
          icon={<UserPlus className="h-4 w-4 text-amber-300" />}
          tone={stats.householdsMissingContact > 0 ? "warning" : "default"}
        />
      </section>

      <RoiPanel roi={roi} />

      {/* Create household drawer (collapsible) */}
      {createOpen ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <SectionHeader
            title={t("households.create.heading")}
            icon={<Users className="h-5 w-5 text-blue-300" />}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => setCreateOpen(false)}
              >
                {t("households.detail.actions.cancel")}
              </Button>
            }
          />
          <Form method="post" className="mt-4 flex flex-col gap-4">
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
        </section>
      ) : null}

      {/* Quick assign + program cancellation broadcaster row */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <SectionHeader
            title={t("households.assign.heading")}
            subtitle={t("households.assign.subtitle")}
            icon={<UserPlus className="h-5 w-5 text-emerald-300" />}
          />
          <Form method="post" className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="intent" value="assign" />
            <Field label={t("households.assign.householdLabel")}>
              <select
                name="householdId"
                className="app-field"
                defaultValue=""
              >
                <option value="">
                  {t("households.assign.householdPlaceholder")}
                </option>
                {householdOptions.map((household: { id: string; name: string }) => (
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
            <Button type="submit" variant="secondary" className="self-start">
              {t("households.assign.submit")}
            </Button>
          </Form>
        </div>

        <div
          id="cancellations"
          className="rounded-xl border border-white/10 bg-white/[0.04] p-5"
        >
          <SectionHeader
            title={t("households.cancellations.broadcastHeading")}
            subtitle={t("households.cancellations.broadcastIntro")}
            icon={<Megaphone className="h-5 w-5 text-amber-300" />}
          />
          <Form method="post" className="mt-4 grid gap-3">
            <input type="hidden" name="intent" value="createCancellation" />
            <Field label={t("households.cancellations.existingProgramLabel")}>
              <select
                name="programId"
                className="app-field"
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
                  className="app-field"
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
          {recentCancellations.length > 0 ? (
            <div className="mt-4 grid gap-2">
              <p className="text-xs uppercase tracking-wide text-white/45">
                {t("households.cancellations.recentHeading")}
              </p>
              {recentCancellations.slice(0, 3).map((notice: CancellationRecord) => (
                <div
                  key={notice.id}
                  className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3"
                >
                  <p className="text-sm font-semibold text-white">{notice.title}</p>
                  <p className="text-xs text-amber-200">
                    {notice.programName} · {notice.cancellationDate}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Active exception broadcaster (read-only org-wide list) */}
      <section
        id="exceptions"
        className="rounded-xl border border-white/10 bg-white/[0.04] p-5"
      >
        <SectionHeader
          title={t("households.exceptions.activeHeading")}
          subtitle={t("households.exceptions.activeSubtitle")}
          icon={<CalendarClock className="h-5 w-5 text-cyan-300" />}
          count={activeExceptions.length}
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {activeExceptions.length === 0 ? (
            <p className="rounded-lg bg-black/20 p-4 text-sm text-white/45 md:col-span-2">
              {t("households.exceptions.noneActive")}
            </p>
          ) : (
            activeExceptions.slice(0, 6).map((exception: ExceptionRecord) => (
              <div
                key={exception.id}
                className="rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">
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
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Search + filter row */}
      <section className="flex flex-col gap-4">
        <Form
          method="get"
          className="flex flex-wrap items-end gap-3"
          role="search"
        >
          <Field label={t("households.search.label")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                name="q"
                type="search"
                defaultValue={pagination.searchQuery}
                placeholder={t("households.search.richPlaceholder")}
                className="min-w-72 pl-9"
              />
            </div>
          </Field>
          {/* Preserve active filter through search submissions. */}
          {pagination.filter !== "all" ? (
            <input type="hidden" name="filter" value={pagination.filter} />
          ) : null}
          <Button type="submit" variant="secondary">
            {t("households.search.submit")}
          </Button>
          {pagination.searchQuery ? (
            <Link
              to={pagination.filter !== "all" ? `?filter=${pagination.filter}` : "?"}
              className="rounded-full border border-white/15 px-3 py-2 text-sm text-white/70 hover:border-white/30 hover:text-white"
            >
              {t("households.search.clear")}
            </Link>
          ) : null}
          <p className="ml-auto text-sm text-white/50">
            {t("households.pagination.totalCount", {
              count: pagination.totalHouseholds,
            })}
          </p>
        </Form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-white/40">
            {t("households.filters.label")}
          </span>
          <FilterPill
            value="all"
            current={pagination.filter}
            searchQuery={pagination.searchQuery}
            label={t("households.filters.all")}
          />
          <FilterPill
            value="exceptionToday"
            current={pagination.filter}
            searchQuery={pagination.searchQuery}
            label={t("households.filters.exceptionToday")}
          />
          <FilterPill
            value="missingContact"
            current={pagination.filter}
            searchQuery={pagination.searchQuery}
            label={t("households.filters.missingContact")}
          />
          <FilterPill
            value="singleParent"
            current={pagination.filter}
            searchQuery={pagination.searchQuery}
            label={t("households.filters.singleParent")}
          />
          <FilterPill
            value="multiStudent"
            current={pagination.filter}
            searchQuery={pagination.searchQuery}
            label={t("households.filters.multiStudent")}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {households.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50 xl:col-span-2">
              {pagination.searchQuery
                ? t("households.list.noResults", {
                    query: pagination.searchQuery,
                  })
                : t("households.list.empty")}
            </div>
          ) : (
            households.map((household: HouseholdRecord) => (
              <HouseholdCard
                key={household.id}
                household={household}
                dateFmt={dateFmt}
              />
            ))
          )}
        </div>

        {pagination.totalPages > 1 ? (
          <HouseholdsPaginationControls pagination={pagination} t={t} />
        ) : null}
      </section>
    </div>
  );
}

function FilterPill({
  value,
  current,
  searchQuery,
  label,
}: {
  value: FilterValue;
  current: FilterValue;
  searchQuery: string;
  label: string;
}) {
  const params = new URLSearchParams();
  if (value !== "all") params.set("filter", value);
  if (searchQuery) params.set("q", searchQuery);
  const qs = params.toString();
  const href = qs ? `?${qs}` : "?";
  const active = current === value;
  return (
    <Link
      to={href}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-blue-400/40 bg-blue-400/15 text-blue-100"
          : "border-white/10 bg-white/5 text-white/65 hover:border-white/25 hover:text-white"
      }`}
      aria-pressed={active}
    >
      {label}
    </Link>
  );
}

function HouseholdsPaginationControls({
  pagination,
  t,
}: {
  pagination: LoaderData["pagination"];
  t: TFunction;
}) {
  const { page, totalPages, searchQuery, filter } = pagination;
  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (targetPage > 1) params.set("page", String(targetPage));
    if (searchQuery) params.set("q", searchQuery);
    if (filter && filter !== "all") params.set("filter", filter);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };
  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < totalPages ? page + 1 : null;
  return (
    <nav
      className="flex items-center justify-between gap-3 text-sm"
      aria-label={t("households.pagination.ariaLabel")}
    >
      {prevPage ? (
        <Link
          to={buildHref(prevPage)}
          rel="prev"
          className="rounded-full border border-white/15 px-3 py-1 text-white/80 hover:border-white/30 hover:text-white"
        >
          {t("households.pagination.prev")}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <p className="text-white/60">
        {t("households.pagination.pageOf", { page, totalPages })}
      </p>
      {nextPage ? (
        <Link
          to={buildHref(nextPage)}
          rel="next"
          className="rounded-full border border-white/15 px-3 py-1 text-white/80 hover:border-white/30 hover:text-white"
        >
          {t("households.pagination.next")}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

function RoiPanel({ roi }: { roi: LoaderData["roi"] }) {
  const { t } = useTranslation("admin");
  return (
    <section
      id="roi"
      className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-5"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            <TrendingUp className="h-4 w-4" />
            {t("households.roi.eyebrow")}
          </div>
          <h2 className="mt-2 text-lg font-semibold text-white">
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
              className="app-field"
            />
          </Field>
          <Field label={t("households.roi.toLabel")}>
            <input
              type="date"
              name="to"
              defaultValue={roi.range.to}
              className="app-field"
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

      <p className="mt-4 text-xs text-white/55">
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

function HouseholdCard({
  household,
  dateFmt,
}: {
  household: HouseholdRecord;
  dateFmt: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation("admin");
  const studentCount = household.students.length;
  const exceptionTodayCount = household.exceptionTodayCount ?? 0;
  const contactCount =
    (household.primaryContactName?.trim() ? 1 : 0) +
    (household.primaryContactPhone?.trim() ? 1 : 0);
  const missingContact =
    !household.primaryContactName?.trim() ||
    !household.primaryContactPhone?.trim();
  const created = (() => {
    try {
      return dateFmt.format(new Date(household.createdAt));
    } catch {
      return "";
    }
  })();

  return (
    <article className="group relative rounded-xl border border-white/8 bg-white/[0.04] p-5 transition-colors hover:border-white/20">
      <Link
        to={`/admin/households/${household.id}`}
        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        aria-label={t("households.card.viewDetail")}
      />
      <div className="relative flex items-start gap-4">
        <EntityAvatar
          initials={initialsFromHouseholdName(household.name)}
          colorSeed={household.id}
          size="lg"
          shape="square"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white truncate">
              {household.name}
            </h2>
            <StatusPill tone="success" size="xs">
              {t("households.card.active")}
            </StatusPill>
            {household.spaceNumber ? (
              <StatusPill tone="cyan" size="xs">
                #{household.spaceNumber}
              </StatusPill>
            ) : null}
            {exceptionTodayCount > 0 ? (
              <StatusPill tone="info" size="xs">
                {t("households.list.exceptions", { count: exceptionTodayCount }).replace(/^[\s·]+/, "")}
              </StatusPill>
            ) : null}
            {missingContact ? (
              <StatusPill tone="warning" size="xs">
                {t("households.stats.missingContact")}
              </StatusPill>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-white/55">
            {t("households.card.students", { count: studentCount })}
            {" · "}
            {t("households.card.contacts", { count: contactCount })}
            {created ? ` · ${t("households.card.createdOn", { date: created })}` : ""}
          </p>

          {/* Mini avatar stack of contacts (today: just primary contact) */}
          <div className="mt-3 flex items-center gap-2">
            {household.primaryContactName ? (
              <div className="flex items-center gap-2">
                <EntityAvatar
                  initials={
                    initialsFromPersonName(
                      household.primaryContactName.split(/\s+/)[0] ?? "",
                      household.primaryContactName.split(/\s+/).slice(-1)[0] ?? "",
                    )
                  }
                  colorSeed={`${household.id}:${household.primaryContactName}`}
                  size="sm"
                />
                <span className="text-xs text-white/65">
                  {household.primaryContactName}
                </span>
                {household.primaryContactPhone ? (
                  <span className="text-xs text-white/40">
                    · {household.primaryContactPhone}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-xs text-white/40">
                {t("households.card.noContacts")}
              </span>
            )}
          </div>

          {/* Mini list of students with classroom badges */}
          <div className="mt-3">
            {household.students.length === 0 ? (
              <p className="text-xs text-white/40">
                {t("households.card.noStudents")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {household.students.slice(0, 4).map((student) => (
                  <li
                    key={student.id}
                    className="flex items-center gap-2 text-sm text-white/85"
                  >
                    <EntityAvatar
                      initials={initialsFromPersonName(student.firstName, student.lastName)}
                      colorSeed={`student:${student.id}`}
                      size="xs"
                    />
                    <span className="truncate">
                      {studentDisplayName(student)}
                    </span>
                    {student.homeRoom ? (
                      <StatusPill tone="neutral" size="xs">
                        {student.homeRoom}
                      </StatusPill>
                    ) : null}
                  </li>
                ))}
                {household.students.length > 4 ? (
                  <li className="text-xs text-white/40">
                    +{household.students.length - 4}
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </div>
        <div className="relative flex shrink-0 flex-col gap-2">
          <EntityLink to={`/admin/households/${household.id}`} arrow>
            {t("households.card.open")}
          </EntityLink>
        </div>
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
