import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Search, Users, GraduationCap } from "lucide-react";
import type { Route } from "./+types/children";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { gradeLabel, type GradeLevel } from "~/domain/children/grade";
import { chunkedFindMany } from "~/db/chunked-in";
import { EntityAvatar, initialsFromName } from "~/components/admin/EntityAvatar";
import { StatusPill } from "~/components/admin/StatusPill";
import { EntityLink } from "~/components/admin/EntityLink";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { StatCard } from "~/components/admin/StatCard";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Children" },
];

type StudentCard = {
  id: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
  classroomId: number | null;
  classroomGrade: GradeLevel | null;
  householdId: string | null;
  householdName: string | null;
  spaceNumber: number | null;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  // Lighter than the classrooms page: a single searchable card grid. Even a
  // 600-student school is <60kB on the wire, so no pagination.
  //
  // We deliberately do NOT use nested relation `select`s for teacher/household.
  // Prisma resolves those with an implicit `WHERE id IN (…all distinct ids…)`
  // query, and with hundreds of distinct households that overflows D1's
  // 100-bound-param cap ("too many SQL variables"). Instead fetch the scalar
  // rows, then load each relation via chunked IN queries and stitch in JS.
  const studentsRaw = await prisma.student.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      homeRoom: true,
      householdId: true,
    },
  });

  const householdIds = [
    ...new Set(studentsRaw.map((s) => s.householdId).filter((id): id is string => id != null)),
  ];
  const homeRooms = [
    ...new Set(studentsRaw.map((s) => s.homeRoom).filter((r): r is string => r != null)),
  ];

  // Household and teacher lookups are independent — both derive only from the
  // already-loaded student rows — so resolve them concurrently within this
  // request. Each keeps its own chunked IN to stay under D1's param cap.
  const [householdRows, teacherRows] = await Promise.all([
    chunkedFindMany(householdIds, (idChunk) =>
      prisma.household.findMany({
        where: { id: { in: idChunk } },
        select: { id: true, name: true, spaceNumber: true },
      }),
    ),
    chunkedFindMany(homeRooms, (roomChunk) =>
      prisma.teacher.findMany({
        where: { homeRoom: { in: roomChunk } },
        select: { id: true, homeRoom: true, gradeLevel: true },
      }),
    ),
  ]);

  const householdById = new Map(householdRows.map((h) => [h.id, h]));
  const teacherByHomeRoom = new Map(teacherRows.map((t) => [t.homeRoom, t]));

  const students: StudentCard[] = studentsRaw.map((s) => {
    const teacher = s.homeRoom != null ? teacherByHomeRoom.get(s.homeRoom) : undefined;
    const household = s.householdId != null ? householdById.get(s.householdId) : undefined;
    return {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      homeRoom: s.homeRoom,
      classroomId: teacher?.id ?? null,
      classroomGrade: (teacher?.gradeLevel as GradeLevel | null) ?? null,
      householdId: household?.id ?? null,
      householdName: household?.name ?? null,
      spaceNumber: household?.spaceNumber ?? null,
    };
  });

  // Search matches first/last name OR homeRoom (case-insensitive).
  const lowerQ = q.toLowerCase();
  const filtered = q
    ? students.filter((s) => {
        const full = `${s.firstName} ${s.lastName}`.toLowerCase();
        return (
          full.includes(lowerQ) ||
          (s.homeRoom ?? "").toLowerCase().includes(lowerQ)
        );
      })
    : students;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  return {
    metaTitle: t("childrenList.header.title"),
    students: filtered,
    totalStudents: students.length,
    filter: { q },
  };
}

type LoaderData = Route.ComponentProps["loaderData"];
type StudentRecord = LoaderData["students"][number];

export default function AdminChildrenList({ loaderData }: Route.ComponentProps) {
  const { students, totalStudents, filter } = loaderData;
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {t("childrenList.header.title")}
          </h1>
          <p className="max-w-3xl text-sm text-white/60">
            {t("childrenList.header.subtitle")}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <section className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={t("childrenList.stats.totalStudents")}
          value={totalStudents}
          icon={<Users className="h-4 w-4 text-cyan-300" />}
        />
        <StatCard
          label={t("childrenList.stats.showing")}
          value={students.length}
          caption={
            filter.q
              ? t("childrenList.stats.matching", { query: filter.q })
              : t("childrenList.stats.allStudents")
          }
        />
      </section>

      {/* Search row */}
      <section className="flex flex-col gap-4">
        <Form method="get" className="flex flex-wrap items-end gap-3" role="search">
          <label className="flex flex-col gap-1 text-xs text-white/60">
            <span>{t("childrenList.search.label")}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                name="q"
                type="search"
                defaultValue={filter.q}
                placeholder={t("childrenList.search.placeholder")}
                aria-label={t("childrenList.search.placeholder")}
                className="h-9 min-w-72 rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </label>
          {filter.q ? (
            <Link
              to="?"
              className="rounded-full border border-white/15 px-3 py-2 text-sm text-white/70 hover:border-white/30 hover:text-white"
            >
              {t("childrenList.search.clear")}
            </Link>
          ) : null}
        </Form>

        <SectionHeader
          title={t("childrenList.list.heading")}
          count={students.length}
        />

        {students.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
            {filter.q
              ? t("childrenList.list.noResults", { query: filter.q })
              : t("childrenList.list.empty")}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {students.map((student: StudentRecord) => (
              <StudentCardItem key={student.id} student={student} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StudentCardItem({ student }: { student: StudentRecord }) {
  const { t } = useTranslation("admin");
  const classroomHref =
    student.classroomId != null
      ? `/admin/classrooms?grade=${student.classroomGrade ?? "ungraded"}#homeroom-${student.classroomId}`
      : null;

  return (
    <article className="group relative flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:border-white/20">
      <Link
        to={`/admin/students/${student.id}`}
        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        aria-label={t("childrenList.card.viewDetail")}
      />
      <EntityAvatar
        size="md"
        initials={initialsFromName(`${student.firstName} ${student.lastName}`)}
        colorSeed={`${student.firstName}-${student.lastName}-${student.id}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-white">
            {student.firstName} {student.lastName}
          </h3>
          {student.spaceNumber ? (
            <StatusPill tone="cyan" size="xs">
              #{student.spaceNumber}
            </StatusPill>
          ) : null}
        </div>

        <div className="mt-2 flex flex-col gap-1 text-[11px] text-white/55">
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5 text-white/40" />
            {classroomHref ? (
              <EntityLink to={classroomHref} arrow={false} className="relative z-10">
                {student.homeRoom ?? gradeLabel(student.classroomGrade)}
              </EntityLink>
            ) : (
              <span className="text-white/30">
                {t("childrenList.card.noClassroom")}
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-white/40" />
            {student.householdId ? (
              <EntityLink
                to={`/admin/households/${student.householdId}`}
                arrow={false}
                className="relative z-10"
              >
                {student.householdName ?? t("childrenList.card.household")}
              </EntityLink>
            ) : (
              <span className="text-white/30">
                {t("childrenList.card.noHousehold")}
              </span>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
