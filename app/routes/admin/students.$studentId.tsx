import { useState, type ReactNode } from "react";
import { Form, Link, redirect, useSearchParams } from "react-router";
import { Button, Input, TextArea } from "@heroui/react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Bus,
  Building2,
  Car,
  CircleDot,
  Footprints,
  Heart,
  Home,
  Printer,
  Save,
  Sparkles,
} from "lucide-react";
import type { Route } from "./+types/students.$studentId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  GRADE_LEVELS,
  gradeLabel,
  isGradeLevel,
  type GradeLevel,
} from "~/domain/children/grade";
import { EntityAvatar, initialsFromName } from "~/components/admin/EntityAvatar";
import { StatusPill } from "~/components/admin/StatusPill";
import { EntityLink } from "~/components/admin/EntityLink";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { DISMISSAL_PLANS } from "~/domain/dismissal/schedule";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Student" },
];

const TAB_KEYS = ["profile", "dismissal", "activity", "notes", "files"] as const;
type TabKey = (typeof TAB_KEYS)[number];
function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export async function loader({ params, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const studentId = Number(params.studentId);
  if (!Number.isInteger(studentId)) {
    throw new Response("Invalid student id", { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      teacher: true,
      space: true,
      household: {
        include: {
          students: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              homeRoom: true,
              spaceNumber: true,
            },
          },
        },
      },
      callEvents: {
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });

  if (!student) {
    throw new Response("Student not found", { status: 404 });
  }

  // Today's exception (matches the same logic as the children index, but
  // scoped to a single student so the query is cheap).
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = now.getUTCDay();
  const todaysException = await prisma.dismissalException.findFirst({
    where: {
      isActive: true,
      OR: [
        { studentId: student.id },
        student.householdId ? { householdId: student.householdId } : { id: "__none__" },
      ],
      AND: {
        OR: [
          { scheduleKind: "DATE", exceptionDate: todayUtc },
          { scheduleKind: "WEEKLY", dayOfWeek: dow },
        ],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  // Classrooms list for the move-classroom dropdown.
  const classrooms = await prisma.teacher.findMany({
    orderBy: [{ gradeLevel: "asc" }, { homeRoom: "asc" }],
    select: { id: true, homeRoom: true, gradeLevel: true },
  });

  return {
    metaTitle: `${student.firstName} ${student.lastName}`,
    student: {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      homeRoom: student.homeRoom,
      spaceNumber: student.spaceNumber,
      householdId: student.householdId,
    },
    classroom: student.teacher
      ? {
          id: student.teacher.id,
          homeRoom: student.teacher.homeRoom,
          gradeLevel: (student.teacher.gradeLevel as GradeLevel | null) ?? null,
          teacherName: (student.teacher as { teacherName?: string | null }).teacherName ?? null,
        }
      : null,
    household: student.household
      ? {
          id: student.household.id,
          name: student.household.name,
          primaryContactName: student.household.primaryContactName,
          primaryContactPhone: student.household.primaryContactPhone,
          students: student.household.students,
        }
      : null,
    callEvents: student.callEvents.map((e) => ({
      id: e.id,
      spaceNumber: e.spaceNumber,
      createdAt: e.createdAt.toISOString(),
    })),
    todaysException: todaysException
      ? {
          id: todaysException.id,
          dismissalPlan: todaysException.dismissalPlan,
          notes: todaysException.notes,
          pickupContactName: todaysException.pickupContactName,
        }
      : null,
    classrooms,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const studentId = Number(params.studentId);
  if (!Number.isInteger(studentId)) {
    return dataWithError(null, "Invalid student id.");
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // Defensive — ensure the student is in this org. The tenant extension
  // already enforces this on the read but `update` doesn't get the same
  // implicit filter on a primary-key lookup.
  const existing = await prisma.student.findUnique({ where: { id: studentId } });
  if (!existing || existing.orgId !== org.id) {
    return dataWithError(null, "Student not found.");
  }

  try {
    if (intent === "saveProfile") {
      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const homeRoom = String(formData.get("homeRoom") ?? "").trim();
      const spaceRaw = String(formData.get("spaceNumber") ?? "").trim();
      const spaceNumber = spaceRaw ? Number(spaceRaw) : null;

      if (!firstName || !lastName) {
        return dataWithError(null, "First and last name are required.");
      }

      if (homeRoom) {
        const room = await prisma.teacher.findFirst({ where: { homeRoom } });
        if (!room) {
          return dataWithError(null, "Selected classroom doesn't exist.");
        }
      }

      await prisma.student.update({
        where: { id: studentId },
        data: {
          firstName,
          lastName,
          homeRoom: homeRoom || null,
          spaceNumber: spaceNumber && Number.isInteger(spaceNumber) ? spaceNumber : null,
        },
      });
      return dataWithSuccess(null, "Student saved.");
    }

    if (intent === "moveClassroom") {
      const homeRoom = String(formData.get("homeRoom") ?? "").trim();
      if (!homeRoom) {
        return dataWithError(null, "Pick a classroom.");
      }
      const room = await prisma.teacher.findFirst({ where: { homeRoom } });
      if (!room) {
        return dataWithError(null, "Selected classroom doesn't exist.");
      }
      await prisma.student.update({
        where: { id: studentId },
        data: { homeRoom },
      });
      return dataWithSuccess(null, `Moved to ${homeRoom}.`);
    }

    if (intent === "delete") {
      await prisma.student.delete({ where: { id: studentId } });
      return redirect("/admin/children");
    }
  } catch (error) {
    console.error("students action failed", error);
    return dataWithError(
      null,
      error instanceof Error ? error.message : "Update failed.",
    );
  }
  return dataWithError(null, "Unknown action.");
}

type LoaderData = Route.ComponentProps["loaderData"];

export default function StudentDetail({ loaderData }: Route.ComponentProps) {
  const { student, classroom, household, callEvents, todaysException, classrooms } =
    loaderData;

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "profile";
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "profile";
  const setTab = (next: TabKey) => {
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  };

  const fullName = `${student.firstName} ${student.lastName}`;
  const initials = initialsFromName(fullName);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        classroom={classroom}
        student={student}
      />

      <HeaderCard
        student={student}
        classroom={classroom}
        household={household}
        todaysException={todaysException}
        initials={initials}
        classrooms={classrooms}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.85fr)]">
        <div className="flex flex-col gap-4">
          <Tabs activeTab={activeTab} onChange={setTab} />
          {activeTab === "profile" ? (
            <ProfileTab student={student} classrooms={classrooms} />
          ) : null}
          {activeTab === "dismissal" ? (
            <DismissalTab todaysException={todaysException} />
          ) : null}
          {activeTab === "activity" ? <PlaceholderTab title="Activity" /> : null}
          {activeTab === "notes" ? <PlaceholderTab title="Notes" /> : null}
          {activeTab === "files" ? <PlaceholderTab title="Files" /> : null}
        </div>

        <aside className="flex flex-col gap-4">
          <HouseholdRail household={household} currentStudentId={student.id} />
          <RecentPickupsRail callEvents={callEvents} />
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Breadcrumb                                                             */
/* --------------------------------------------------------------------- */

function Breadcrumb({
  classroom,
  student,
}: {
  classroom: LoaderData["classroom"];
  student: LoaderData["student"];
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-xs text-white/45"
    >
      <Link to="/admin/children" className="inline-flex items-center gap-1 hover:text-white/80">
        <ArrowLeft className="h-3.5 w-3.5" />
        Children
      </Link>
      <span className="text-white/25">/</span>
      {classroom ? (
        <>
          <Link
            to={`/admin/children?grade=${classroom.gradeLevel ?? "ungraded"}`}
            className="hover:text-white/80"
          >
            {gradeLabel(classroom.gradeLevel)}
          </Link>
          <span className="text-white/25">/</span>
          <Link
            to={`/admin/children#grade-${(classroom.gradeLevel ?? "ungraded").toString().toLowerCase()}`}
            className="hover:text-white/80"
          >
            {classroom.homeRoom}
          </Link>
          <span className="text-white/25">/</span>
        </>
      ) : null}
      <span className="text-white/80">{student.firstName} {student.lastName}</span>
    </nav>
  );
}

/* --------------------------------------------------------------------- */
/* Header card                                                            */
/* --------------------------------------------------------------------- */

function HeaderCard({
  student,
  classroom,
  household,
  todaysException,
  initials,
  classrooms,
}: {
  student: LoaderData["student"];
  classroom: LoaderData["classroom"];
  household: LoaderData["household"];
  todaysException: LoaderData["todaysException"];
  initials: string;
  classrooms: LoaderData["classrooms"];
}) {
  return (
    <header className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-white/[0.04] p-5 lg:flex-row lg:items-start">
      <EntityAvatar
        size="lg"
        initials={initials}
        colorSeed={`${student.firstName}-${student.lastName}-${student.id}`}
        ring
      />
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {student.firstName} {student.lastName}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {todaysException ? (
            <StatusPill tone="warning" dot>
              Today: {todaysException.dismissalPlan}
            </StatusPill>
          ) : null}
          {classroom?.gradeLevel == null ? (
            <StatusPill tone="warning">Ungraded classroom</StatusPill>
          ) : null}
          {!household ? (
            <StatusPill tone="danger">No household</StatusPill>
          ) : null}
          {classroom ? (
            <StatusPill tone="info">{classroom.homeRoom}</StatusPill>
          ) : (
            <StatusPill tone="warning">No classroom</StatusPill>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
          {classroom ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-white/40">Classroom</span>
              <EntityLink to={`/admin/children?grade=${classroom.gradeLevel ?? "ungraded"}#grade-${(classroom.gradeLevel ?? "ungraded").toString().toLowerCase()}`}>
                {classroom.homeRoom}
              </EntityLink>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-white/40">Grade</span>
            <span className="text-white/80">
              {gradeLabel(classroom?.gradeLevel ?? null)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-white/40">Space</span>
            <span className="text-white/80 tabular-nums">
              {student.spaceNumber ?? "—"}
            </span>
          </span>
          {household ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-white/40">Household</span>
              <EntityLink to={`/admin/households#${household.id}`}>{household.name}</EntityLink>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 self-start">
        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 hover:border-white/20 hover:text-white">
            <Home className="h-3.5 w-3.5" />
            Move classroom
          </summary>
          <Form
            method="post"
            className="absolute right-0 top-full z-10 mt-1 w-64 rounded-xl border border-white/10 bg-[#1a1f1f] p-3 text-xs shadow-xl"
          >
            <input type="hidden" name="intent" value="moveClassroom" />
            <select
              name="homeRoom"
              defaultValue={classroom?.homeRoom ?? ""}
              className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-white"
            >
              <option value="" disabled>
                Pick classroom…
              </option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.homeRoom}>
                  {c.homeRoom}
                  {c.gradeLevel ? ` · ${gradeLabel(c.gradeLevel as GradeLevel)}` : ""}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" size="sm" className="mt-2 w-full">
              Move
            </Button>
          </Form>
        </details>
        <Link
          to={`/admin/print/homeroom/${classroom?.id ?? ""}`}
          target="_blank"
          rel="noopener"
          aria-disabled={!classroom}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 hover:border-white/20 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
        >
          <Printer className="h-3.5 w-3.5" />
          Print profile
        </Link>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------------- */
/* Tabs                                                                   */
/* --------------------------------------------------------------------- */

function Tabs({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "dismissal", label: "Dismissal" },
    { key: "activity", label: "Activity" },
    { key: "notes", label: "Notes" },
    { key: "files", label: "Files" },
  ];
  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 border-b border-white/[0.08]"
    >
      {tabs.map((t) => {
        const active = t.key === activeTab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`relative -mb-px px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "text-white"
                : "text-white/55 hover:text-white/80"
            }`}
          >
            {t.label}
            {active ? (
              <span className="absolute inset-x-2 bottom-[-1px] h-0.5 rounded-full bg-blue-400" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Profile tab                                                            */
/* --------------------------------------------------------------------- */

function ProfileTab({
  student,
  classrooms,
}: {
  student: LoaderData["student"];
  classrooms: LoaderData["classrooms"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Form method="post" className="flex flex-col gap-5 rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
        <input type="hidden" name="intent" value="saveProfile" />
        <SectionHeader title="Identity" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input name="firstName" defaultValue={student.firstName} required />
          </Field>
          <Field label="Last name">
            <Input name="lastName" defaultValue={student.lastName} required />
          </Field>
          <Field label="Preferred name (optional)">
            <Input name="preferredName" placeholder="—" disabled />
          </Field>
          <Field label="Pronouns (optional)">
            <Input name="pronouns" placeholder="—" disabled />
          </Field>
        </div>

        <SectionHeader title="Placement" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Grade">
            <select
              name="grade"
              defaultValue=""
              className="app-field"
              disabled
              title="Grade is set on the classroom; change via the classroom card."
            >
              <option value="">From classroom</option>
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Classroom">
            <select
              name="homeRoom"
              defaultValue={student.homeRoom ?? ""}
              className="app-field"
            >
              <option value="">Unassigned</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.homeRoom}>
                  {c.homeRoom}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Space #">
            <Input
              name="spaceNumber"
              type="number"
              min={1}
              defaultValue={student.spaceNumber ?? ""}
            />
          </Field>
        </div>

        <SectionHeader title="Health & safety" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allergies">
            <TextArea
              name="allergies"
              rows={2}
              placeholder="None on file"
              disabled
            />
          </Field>
          <Field label="Medication">
            <TextArea
              name="medication"
              rows={2}
              placeholder="None on file"
              disabled
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm">
            <Save className="mr-1 h-3.5 w-3.5" />
            Save changes
          </Button>
          <p className="text-xs text-white/40">
            Health fields aren't yet wired to the schema — coming soon.
          </p>
        </div>
      </Form>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Dismissal tab                                                          */
/* --------------------------------------------------------------------- */

const DISMISSAL_TILES: { key: string; label: string; icon: ReactNode; tone: "info" | "success" | "warning" | "neutral" | "purple" }[] = [
  { key: "Car line", label: "Car line", icon: <Car className="h-5 w-5" />, tone: "info" },
  { key: "Walker", label: "Walker", icon: <Footprints className="h-5 w-5" />, tone: "success" },
  { key: "Bus", label: "Bus", icon: <Bus className="h-5 w-5" />, tone: "warning" },
  { key: "After-school program", label: "After-school", icon: <Sparkles className="h-5 w-5" />, tone: "purple" },
  { key: "Office pickup", label: "Office", icon: <Building2 className="h-5 w-5" />, tone: "neutral" },
  { key: "Other", label: "Other", icon: <CircleDot className="h-5 w-5" />, tone: "neutral" },
];

function DismissalTab({
  todaysException,
}: {
  todaysException: LoaderData["todaysException"];
}) {
  const [defaultPlan, setDefaultPlan] = useState<string>("Car line");
  // Default plan persistence is not yet in the schema (Student doesn't have
  // a defaultPlan column). The picker is wired so admins see the design;
  // hooking it up is a follow-up once the column lands.
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
        <SectionHeader title="Default plan" caption="Used when no exception is set" />
        <p className="mt-2 text-xs text-white/45">
          Tap a tile to set the student's default dismissal route. Exceptions
          (today / weekly) override this on the day they apply.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {DISMISSAL_TILES.map((tile) => {
            const active = tile.key === defaultPlan;
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => setDefaultPlan(tile.key)}
                className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-blue-400/40 bg-blue-500/10"
                    : "border-white/[0.08] bg-black/20 hover:border-white/15 hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{
                    color: active ? "#93c5fd" : "rgba(255,255,255,0.6)",
                    backgroundColor: active ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                  }}
                >
                  {tile.icon}
                </span>
                <span className="text-sm font-medium text-white">{tile.label}</span>
                <StatusPill tone={tile.tone} dot>
                  {DISMISSAL_PLANS.includes(tile.key as (typeof DISMISSAL_PLANS)[number])
                    ? "Recognized plan"
                    : "Custom"}
                </StatusPill>
              </button>
            );
          })}
        </div>
      </section>

      {todaysException ? (
        <section className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400/20 text-amber-200">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.9px] text-amber-200/80">
                Exception today
              </p>
              <h3 className="mt-1 text-base font-semibold text-white">
                {todaysException.dismissalPlan}
                {todaysException.pickupContactName
                  ? ` · ${todaysException.pickupContactName}`
                  : ""}
              </h3>
              {todaysException.notes ? (
                <p className="mt-1 text-sm text-white/65">{todaysException.notes}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Placeholder tabs                                                       */
/* --------------------------------------------------------------------- */

function PlaceholderTab({ title }: { title: string }) {
  return (
    <section className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-sm text-white/55">
      <p className="font-medium text-white/80">{title}</p>
      <p className="mt-1">Coming soon — this tab is part of the next iteration.</p>
    </section>
  );
}

/* --------------------------------------------------------------------- */
/* Right rail — household                                                 */
/* --------------------------------------------------------------------- */

function HouseholdRail({
  household,
  currentStudentId,
}: {
  household: LoaderData["household"];
  currentStudentId: number;
}) {
  if (!household) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
        <SectionHeader title="Household" />
        <p className="mt-2 text-sm text-white/55">
          This student isn't grouped into a household yet. Group them from the{" "}
          <EntityLink to="/admin/households">Households page</EntityLink> to
          enable shared exceptions and pickup notes.
        </p>
      </div>
    );
  }

  const siblings = household.students.filter((s) => s.id !== currentStudentId);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <SectionHeader title="Household" />
      <div className="mt-3 flex items-center gap-3">
        <EntityAvatar
          size="md"
          initials={initialsFromName(household.name)}
          colorSeed={household.id}
        />
        <div className="min-w-0 flex-1">
          <EntityLink to={`/admin/households#${household.id}`}>
            {household.name}
          </EntityLink>
          {household.primaryContactName ? (
            <p className="text-xs text-white/55">
              {household.primaryContactName}
              {household.primaryContactPhone
                ? ` · ${household.primaryContactPhone}`
                : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/45">
          Siblings
        </p>
        {siblings.length === 0 ? (
          <p className="mt-1 text-xs text-white/45">No siblings on file.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {siblings.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2"
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
                    {s.firstName} {s.lastName}
                  </Link>
                  <p className="truncate text-[11px] text-white/45">
                    {s.homeRoom ?? "No classroom"} · Space {s.spaceNumber ?? "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Right rail — recent pickups                                            */
/* --------------------------------------------------------------------- */

function RecentPickupsRail({
  callEvents,
}: {
  callEvents: LoaderData["callEvents"];
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <SectionHeader title="Recent pickups" />
      {callEvents.length === 0 ? (
        <p className="mt-2 text-xs text-white/45">No pickups recorded yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {callEvents.map((e) => {
            const when = new Date(e.createdAt);
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="text-white/80">
                    Space <span className="font-semibold tabular-nums">{e.spaceNumber}</span>
                  </p>
                  <p className="text-white/45">
                    {when.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {when.toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <Heart className="h-3.5 w-3.5 text-rose-300/80" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Field helper                                                           */
/* --------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/60">
      <span>{label}</span>
      {children}
    </label>
  );
}
