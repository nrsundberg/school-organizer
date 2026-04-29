import { useEffect, useMemo, useState } from "react";
import { Form, Link, useSearchParams, useSubmit } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  Printer,
  Search,
  Users,
  UsersRound,
} from "lucide-react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/children";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  DEFAULT_CLASSROOM_CAPACITY,
  GRADE_LEVELS,
  classroomFillRatio,
  classroomFillState,
  findUnassignedStudents,
  gradeFilterCounts,
  gradeLabel,
  gradeShortLabel,
  groupClassroomsByGrade,
  isGradeLevel,
  type GradeLevel,
} from "~/domain/children/grade";
import { EntityAvatar, initialsFromName } from "~/components/admin/EntityAvatar";
import { StatusPill } from "~/components/admin/StatusPill";
import { EntityLink } from "~/components/admin/EntityLink";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { StatCard } from "~/components/admin/StatCard";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Children & classrooms" },
];

type ClassroomLoaderRow = {
  id: number;
  homeRoom: string;
  gradeLevel: GradeLevel | null;
  capacity: number | null;
  teacherName: string | null;
  studentCount: number;
};

type StudentLoaderRow = {
  id: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
  spaceNumber: number | null;
  householdId: string | null;
  householdName: string | null;
  todaysException: { id: string; dismissalPlan: string } | null;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const gradeParam = url.searchParams.get("grade") ?? "";
  const gradeFilter: GradeLevel | "ungraded" | null = isGradeLevel(gradeParam)
    ? gradeParam
    : gradeParam === "ungraded"
      ? "ungraded"
      : null;

  // Pull all classrooms for the org. Schools rarely have more than ~50, so
  // listing them all on a single page is fine. Students are joined via
  // homeRoom/orgId composite (see schema). We fetch students separately so
  // the search filter can run on either side.
  const classrooms = await prisma.teacher.findMany({
    orderBy: [{ gradeLevel: "asc" }, { homeRoom: "asc" }],
    select: {
      id: true,
      homeRoom: true,
      gradeLevel: true,
      capacity: true,
      teacherName: true,
    },
  });

  const validHomeRooms = new Set(classrooms.map((c) => c.homeRoom));

  // Pull every student (no pagination here — even a 600-student school is
  // <60kB on the wire). Search applies to first/last name OR homeRoom.
  const allStudentsRaw = await prisma.student.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      homeRoom: true,
      householdId: true,
      household: { select: { spaceNumber: true } },
    },
  });
  const allStudents = allStudentsRaw.map((s) => ({
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    homeRoom: s.homeRoom,
    householdId: s.householdId,
    spaceNumber: s.household?.spaceNumber ?? null,
  }));

  // Pull active exceptions for "today" so we can flag students with an
  // override on the index. We use UTC date midnight to match how DATE rows
  // are stored. WEEKLY rows are filtered separately below so we only
  // include the day matching today.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const dow = now.getUTCDay();
  const exceptions = await prisma.dismissalException.findMany({
    where: {
      isActive: true,
      OR: [
        { scheduleKind: "DATE", exceptionDate: todayUtc },
        { scheduleKind: "WEEKLY", dayOfWeek: dow },
      ],
    },
    select: {
      id: true,
      studentId: true,
      householdId: true,
      dismissalPlan: true,
      scheduleKind: true,
      startsOn: true,
      endsOn: true,
    },
  });

  // Resolve household names in one extra query — used both for the
  // student.householdName field on the index and for resolving
  // household-scoped exceptions back to the right student rows.
  const householdIds = Array.from(
    new Set(allStudents.map((s) => s.householdId).filter((id): id is string => !!id)),
  );
  const households =
    householdIds.length === 0
      ? []
      : await prisma.household.findMany({
          where: { id: { in: householdIds } },
          select: { id: true, name: true },
        });
  const householdNameById = new Map(households.map((h) => [h.id, h.name]));

  // Index per-student exceptions. Household-scoped exceptions cascade to
  // every student in the household.
  const exceptionsByStudent = new Map<number, { id: string; dismissalPlan: string }>();
  for (const ex of exceptions) {
    if (ex.studentId != null) {
      exceptionsByStudent.set(ex.studentId, {
        id: ex.id,
        dismissalPlan: ex.dismissalPlan,
      });
    } else if (ex.householdId) {
      for (const s of allStudents) {
        if (s.householdId === ex.householdId && !exceptionsByStudent.has(s.id)) {
          exceptionsByStudent.set(s.id, {
            id: ex.id,
            dismissalPlan: ex.dismissalPlan,
          });
        }
      }
    }
  }

  // Apply search filter — matches on first/last name OR homeRoom (case
  // insensitive). Empty `q` is a no-op.
  const lowerQ = q.toLowerCase();
  const filteredStudents = q
    ? allStudents.filter((s) => {
        const full = `${s.firstName} ${s.lastName}`.toLowerCase();
        return (
          full.includes(lowerQ) ||
          (s.homeRoom ?? "").toLowerCase().includes(lowerQ)
        );
      })
    : allStudents;

  const studentsByRoom = new Map<string, StudentLoaderRow[]>();
  for (const s of filteredStudents) {
    if (!s.homeRoom) continue;
    const arr = studentsByRoom.get(s.homeRoom) ?? [];
    arr.push({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      homeRoom: s.homeRoom,
      spaceNumber: s.spaceNumber,
      householdId: s.householdId,
      householdName: s.householdId
        ? householdNameById.get(s.householdId) ?? null
        : null,
      todaysException: exceptionsByStudent.get(s.id) ?? null,
    });
    studentsByRoom.set(s.homeRoom, arr);
  }

  // Build the canonical classroom rows used by the page. studentCount
  // reflects the *unfiltered* enrollment so the stats stay stable as you
  // type in the search box; the expanded list uses the filtered students.
  const enrolmentByRoom = new Map<string, number>();
  for (const s of allStudents) {
    if (!s.homeRoom) continue;
    enrolmentByRoom.set(s.homeRoom, (enrolmentByRoom.get(s.homeRoom) ?? 0) + 1);
  }
  const classroomRows: ClassroomLoaderRow[] = classrooms.map((c) => ({
    id: c.id,
    homeRoom: c.homeRoom,
    gradeLevel: (c.gradeLevel as GradeLevel | null) ?? null,
    capacity: c.capacity,
    teacherName: c.teacherName,
    studentCount: enrolmentByRoom.get(c.homeRoom) ?? 0,
  }));

  const unassignedStudentsList = findUnassignedStudents(allStudents, validHomeRooms);

  const totalStudents = allStudents.length;
  const totalClassrooms = classroomRows.length;
  const avgClassSize =
    totalClassrooms > 0
      ? Math.round((totalStudents / totalClassrooms) * 10) / 10
      : 0;

  return {
    metaTitle: "Children & classrooms",
    classrooms: classroomRows,
    studentsByRoom: Object.fromEntries(studentsByRoom),
    unassignedStudents: unassignedStudentsList.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      homeRoom: s.homeRoom,
    })),
    stats: {
      totalStudents,
      totalClassrooms,
      avgClassSize,
      unassignedCount: unassignedStudentsList.length,
    },
    filter: {
      q,
      grade: gradeFilter,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "setClassroomGrade") {
      const classroomId = Number(formData.get("classroomId"));
      const grade = String(formData.get("grade") ?? "");
      if (!Number.isInteger(classroomId)) {
        return dataWithError(null, "Invalid classroom.");
      }
      if (grade && !isGradeLevel(grade)) {
        return dataWithError(null, "Invalid grade level.");
      }
      // Belt and braces: tenant extension already filters by orgId, but
      // double-check that the row we're touching belongs to the request's org.
      const existing = await prisma.teacher.findUnique({ where: { id: classroomId } });
      if (!existing || existing.orgId !== org.id) {
        return dataWithError(null, "Classroom not found.");
      }
      await prisma.teacher.update({
        where: { id: classroomId },
        data: { gradeLevel: grade ? (grade as GradeLevel) : null },
      });
      return dataWithSuccess(null, "Grade updated.");
    }
  } catch (error) {
    console.error("children action failed", error);
    return dataWithError(
      null,
      error instanceof Error ? error.message : "Update failed.",
    );
  }
  return dataWithError(null, "Unknown action.");
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function AdminChildren({ loaderData }: Route.ComponentProps) {
  const { classrooms, studentsByRoom, stats, filter } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();

  // Expanded card state — keyed by classroom id. Local-only because the
  // brief calls for inline expansion (no route change).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // When a child detail page links here with `#homeroom-<id>`, expand the
  // matching card and scroll it into view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = /^#homeroom-(\d+)$/.exec(window.location.hash);
    if (!m) return;
    const id = Number(m[1]);
    if (!Number.isInteger(id)) return;
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const tm = setTimeout(() => {
      document
        .getElementById(`homeroom-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => clearTimeout(tm);
  }, []);

  // Grade pill filter buckets — derived from the loader data. We ignore the
  // search filter here so the pills stay representative of the school as a
  // whole; the cards handle per-search filtering separately.
  const filterCounts = useMemo(() => gradeFilterCounts(classrooms), [classrooms]);

  // Render groups (filtered by `?grade=`).
  const groups = useMemo(() => {
    const all = groupClassroomsByGrade(classrooms);
    if (!filter.grade) return all;
    if (filter.grade === "ungraded") {
      return all.filter((g) => g.grade == null);
    }
    return all.filter((g) => g.grade === filter.grade);
  }, [classrooms, filter.grade]);

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const onGradePill = (g: GradeLevel | null | "all") => {
    if (g === "all") updateParam("grade", null);
    else if (g == null) updateParam("grade", "ungraded");
    else updateParam("grade", g);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader filter={filter} onSearchSubmit={(formData) => submit(formData, { method: "get", replace: true })} />

      <StatsRow stats={stats} />

      <GradePillBar
        filterCounts={filterCounts}
        active={filter.grade}
        onSelect={onGradePill}
      />

      {groups.length === 0 ? (
        <EmptyState searching={!!filter.q || !!filter.grade} />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <GradeGroup
              key={group.grade ?? "__ungraded__"}
              grade={group.grade}
              classrooms={group.classrooms}
              studentCount={group.studentCount}
              studentsByRoom={studentsByRoom}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Page header + search                                                  */
/* --------------------------------------------------------------------- */

function PageHeader({
  filter,
  onSearchSubmit,
}: {
  filter: LoaderData["filter"];
  onSearchSubmit: (form: HTMLFormElement) => void;
}) {
  const { t } = useTranslation("admin");
  const [addOpen, setAddOpen] = useState(false);

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/45">
          {t("children.pageHeader.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          {t("children.pageHeader.title")}
        </h1>
        <p className="mt-1 text-sm text-white/55">{t("children.pageHeader.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Form
          method="get"
          replace
          role="search"
          className="relative"
          onSubmit={(e) => {
            // Submitting the form via Enter goes through React Router's
            // submit() so other params (e.g. ?grade=) are preserved.
            e.preventDefault();
            onSearchSubmit(e.currentTarget);
          }}
        >
          {/* Preserve grade filter when searching. */}
          {filter.grade ? (
            <input
              type="hidden"
              name="grade"
              value={filter.grade === "ungraded" ? "ungraded" : filter.grade}
            />
          ) : null}
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={filter.q}
            placeholder={t("children.search.placeholder")}
            aria-label={t("children.search.placeholder")}
            className="h-9 w-72 rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </Form>

        <div className="relative">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAddOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={addOpen}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("children.addMenu.trigger")}
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
          {addOpen ? (
            <div
              className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-white/10 bg-[#1a1f1f] p-1.5 shadow-xl"
              onMouseLeave={() => setAddOpen(false)}
              role="menu"
            >
              <AddMenuItem
                href="/create/student"
                label={t("children.addMenu.child.label")}
                hint={t("children.addMenu.child.hint")}
              />
              <AddMenuItem
                href="/create/homeroom"
                label={t("children.addMenu.classroom.label")}
                hint={t("children.addMenu.classroom.hint")}
              />
              <AddMenuItem
                href="/admin/roster-import"
                label={t("children.addMenu.import.label")}
                hint={t("children.addMenu.import.hint")}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function AddMenuItem({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={href}
      className="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm text-white hover:bg-white/[0.06]"
      role="menuitem"
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs text-white/50">{hint}</span>
    </Link>
  );
}

/* --------------------------------------------------------------------- */
/* Stats row                                                              */
/* --------------------------------------------------------------------- */

function StatsRow({ stats }: { stats: LoaderData["stats"] }) {
  const { t } = useTranslation("admin");
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("children.stats.students")}
        value={stats.totalStudents}
        icon={<Users className="h-4 w-4" />}
      />
      <StatCard
        label={t("children.stats.classrooms")}
        value={stats.totalClassrooms}
        icon={<UsersRound className="h-4 w-4" />}
      />
      <StatCard
        label={t("children.stats.avgClassSize")}
        value={stats.avgClassSize}
        caption={t("children.stats.defaultCap", { count: DEFAULT_CLASSROOM_CAPACITY })}
      />
      <StatCard
        label={t("children.stats.unassigned")}
        value={stats.unassignedCount}
        caption={
          stats.unassignedCount > 0
            ? t("children.stats.unassignedCaption")
            : t("children.stats.allPlaced")
        }
        tone={stats.unassignedCount > 0 ? "warning" : "default"}
        icon={
          stats.unassignedCount > 0 ? (
            <AlertCircle className="h-4 w-4" />
          ) : null
        }
      />
    </section>
  );
}

/* --------------------------------------------------------------------- */
/* Grade pill bar                                                         */
/* --------------------------------------------------------------------- */

function GradePillBar({
  filterCounts,
  active,
  onSelect,
}: {
  filterCounts: { grade: GradeLevel | null; studentCount: number; classroomCount: number }[];
  active: GradeLevel | "ungraded" | null;
  onSelect: (grade: GradeLevel | null | "all") => void;
}) {
  // Sort `filterCounts` for the pill bar in the same canonical grade order.
  // We only render grades that actually have classrooms.
  const totalStudents = filterCounts.reduce((acc, f) => acc + f.studentCount, 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <GradePill
        active={active == null}
        label="All"
        count={totalStudents}
        onClick={() => onSelect("all")}
      />
      {filterCounts.map((f) => {
        const key = f.grade ?? "__ungraded__";
        const isActive =
          (active === "ungraded" && f.grade == null) ||
          (active != null && active !== "ungraded" && active === f.grade);
        return (
          <GradePill
            key={key}
            active={isActive}
            label={gradeShortLabel(f.grade)}
            count={f.studentCount}
            tone={f.grade == null ? "warning" : "default"}
            onClick={() => onSelect(f.grade)}
          />
        );
      })}
    </div>
  );
}

function GradePill({
  active,
  label,
  count,
  tone = "default",
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  tone?: "default" | "warning";
  onClick: () => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors";
  const styles = active
    ? tone === "warning"
      ? "bg-amber-500/15 text-amber-100 ring-amber-400/40"
      : "bg-blue-500/20 text-blue-100 ring-blue-400/40"
    : tone === "warning"
      ? "bg-amber-500/[0.06] text-amber-200/80 ring-amber-500/20 hover:bg-amber-500/10"
      : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.07]";
  return (
    <button type="button" onClick={onClick} className={`${base} ${styles}`}>
      <span>{label}</span>
      <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
        {count}
      </span>
    </button>
  );
}

/* --------------------------------------------------------------------- */
/* Grade group                                                            */
/* --------------------------------------------------------------------- */

function GradeGroup({
  grade,
  classrooms,
  studentCount,
  studentsByRoom,
  expanded,
  toggleExpanded,
}: {
  grade: GradeLevel | null;
  classrooms: ClassroomLoaderRow[];
  studentCount: number;
  studentsByRoom: Record<string, StudentLoaderRow[]>;
  expanded: Set<number>;
  toggleExpanded: (id: number) => void;
}) {
  const id =
    grade == null ? "grade-ungraded" : `grade-${grade.toLowerCase()}`;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        id={id}
        title={gradeLabel(grade)}
        count={`${classrooms.length} classroom${classrooms.length === 1 ? "" : "s"}`}
        caption={`${studentCount} student${studentCount === 1 ? "" : "s"}`}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {classrooms.map((c) => (
          <ClassroomCard
            key={c.id}
            classroom={c}
            students={studentsByRoom[c.homeRoom] ?? []}
            expanded={expanded.has(c.id)}
            onToggle={() => toggleExpanded(c.id)}
          />
        ))}
        <AddClassroomTile grade={grade} />
      </div>
    </section>
  );
}

function AddClassroomTile({ grade }: { grade: GradeLevel | null }) {
  return (
    <Link
      to={`/create/homeroom${grade ? `?grade=${grade}` : ""}`}
      className="flex min-h-[148px] items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-white/45 transition-colors hover:border-white/30 hover:bg-white/[0.03] hover:text-white/70"
    >
      <span className="inline-flex items-center gap-2">
        <Plus className="h-4 w-4" />
        Add classroom to {gradeLabel(grade)}
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------------- */
/* Classroom card                                                         */
/* --------------------------------------------------------------------- */

function ClassroomCard({
  classroom,
  students,
  expanded,
  onToggle,
}: {
  classroom: ClassroomLoaderRow;
  students: StudentLoaderRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const cap = classroom.capacity ?? DEFAULT_CLASSROOM_CAPACITY;
  const ratio = classroomFillRatio(classroom.studentCount, classroom.capacity);
  const fillState = classroomFillState(classroom.studentCount, classroom.capacity);
  const fillColor =
    fillState === "over-cap"
      ? "bg-rose-400"
      : fillState === "near-cap"
        ? "bg-amber-400"
        : "bg-blue-400";

  const teacherInitials = initialsFromName(classroom.teacherName ?? classroom.homeRoom);
  const ungraded = classroom.gradeLevel == null;

  return (
    <article
      id={`homeroom-${classroom.id}`}
      className={`flex flex-col rounded-xl border bg-white/[0.04] transition-colors ${
        expanded ? "border-blue-400/40 ring-1 ring-blue-400/10" : "border-white/[0.08] hover:border-white/15"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
        aria-expanded={expanded}
      >
        <EntityAvatar
          initials={teacherInitials}
          colorSeed={classroom.homeRoom}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-white">
              {classroom.homeRoom}
            </h3>
            {ungraded ? (
              <StatusPill tone="warning" dot>
                Ungraded
              </StatusPill>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-white/55">
            {classroom.teacherName ?? "Teacher not set"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs tabular-nums text-white/70">
              {classroom.studentCount}
              <span className="text-white/40"> / {cap}</span>
            </span>
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              students
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full ${fillColor}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-white/40" />
        ) : (
          <ChevronRight className="h-4 w-4 text-white/40" />
        )}
      </button>

      {ungraded ? <UngradedPrompt classroomId={classroom.id} /> : null}

      {expanded ? (
        <ExpandedClassroom
          classroom={classroom}
          students={students}
        />
      ) : null}
    </article>
  );
}

function UngradedPrompt({ classroomId }: { classroomId: number }) {
  // Inline form to set the grade for this classroom. Kept compact — one
  // select + a save button — so the "ungraded" callout doesn't blow up the
  // card visually.
  return (
    <Form
      method="post"
      className="flex items-center gap-2 border-t border-white/[0.06] bg-amber-500/[0.04] px-4 py-2 text-xs text-amber-100"
      onClick={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="intent" value="setClassroomGrade" />
      <input type="hidden" name="classroomId" value={classroomId} />
      <span className="font-medium">Set grade:</span>
      <select
        name="grade"
        defaultValue=""
        className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white focus:border-blue-400/60 focus:outline-none"
      >
        <option value="" disabled>
          Pick…
        </option>
        {GRADE_LEVELS.map((g) => (
          <option key={g} value={g}>
            {gradeLabel(g)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-400/30"
      >
        Save
      </button>
    </Form>
  );
}

function ExpandedClassroom({
  classroom,
  students,
}: {
  classroom: ClassroomLoaderRow;
  students: StudentLoaderRow[];
}) {
  return (
    <div
      className="flex flex-col gap-3 border-t border-white/[0.08] bg-black/20 p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Select all students"
            className="h-4 w-4 rounded border border-white/15 bg-black/30 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-xs text-white/55">Select all</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" type="button" isDisabled>
            <Users className="mr-1 h-3.5 w-3.5" />
            Bulk move
          </Button>
          <Link
            to={`/admin/print/homeroom/${classroom.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/80 hover:border-white/20 hover:text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            Print roster
          </Link>
        </div>
      </div>

      {students.length === 0 ? (
        <p className="rounded-lg bg-black/30 p-4 text-sm text-white/45">
          No students in this classroom yet.
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {students.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
            >
              <EntityAvatar
                size="sm"
                initials={initialsFromName(`${s.firstName} ${s.lastName}`)}
                colorSeed={`${s.firstName}-${s.lastName}-${s.id}`}
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/admin/students/${s.id}`}
                  className="truncate text-sm font-medium text-white hover:text-blue-200"
                >
                  {s.lastName}, {s.firstName}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/55">
                  {s.householdId ? (
                    <EntityLink to={`/admin/households/${s.householdId}`} arrow={false}>
                      {s.householdName ?? "Household"}
                    </EntityLink>
                  ) : (
                    <span className="text-white/30">No household</span>
                  )}
                  <span className="text-white/30">·</span>
                  <span>
                    Space {s.spaceNumber ?? <span className="text-white/30">—</span>}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {s.todaysException ? (
                  <StatusPill tone="warning" dot>
                    {s.todaysException.dismissalPlan}
                  </StatusPill>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Empty state                                                            */
/* --------------------------------------------------------------------- */

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-sm text-white/55">
      {searching
        ? "No classrooms match the current filters."
        : "No classrooms yet. Add a classroom to get started."}
    </div>
  );
}
