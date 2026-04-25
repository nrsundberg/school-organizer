import { Form, Link } from "react-router";
import { Button, Input, Textarea } from "@heroui/react";
import { Home, UserMinus, Users } from "lucide-react";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import type { Route } from "./+types/households";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  defaultHouseholdName,
  parseStudentIds,
  studentDisplayName,
} from "~/domain/households/households.server";

export const meta: Route.MetaFunction = () => [{ title: "Admin – Households" }];

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const [households, unassignedStudents, allStudents] = await Promise.all([
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
          select: { id: true, dismissalPlan: true, scheduleKind: true },
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
  ]);

  return { households, unassignedStudents, allStudents };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      const studentIds = parseStudentIds(formData);
      if (studentIds.length === 0) {
        return dataWithError(null, "Choose at least one student to group.");
      }

      const students = await prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      if (students.length === 0) {
        return dataWithError(null, "No matching students found.");
      }

      const requestedName = String(formData.get("name") ?? "").trim();
      const household = await prisma.household.create({
        data: {
          name: requestedName || defaultHouseholdName(students),
          pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
          primaryContactName: String(formData.get("primaryContactName") ?? "").trim() || null,
          primaryContactPhone: String(formData.get("primaryContactPhone") ?? "").trim() || null,
        },
      });

      await prisma.student.updateMany({
        where: { id: { in: students.map((student) => student.id) } },
        data: { householdId: household.id },
      });

      return dataWithSuccess(null, `Created ${household.name}.`);
    }

    if (intent === "update") {
      const householdId = String(formData.get("householdId") ?? "");
      const name = String(formData.get("name") ?? "").trim();
      if (!householdId || !name) {
        return dataWithError(null, "Household name is required.");
      }

      await prisma.household.update({
        where: { id: householdId },
        data: {
          name,
          pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
          primaryContactName: String(formData.get("primaryContactName") ?? "").trim() || null,
          primaryContactPhone: String(formData.get("primaryContactPhone") ?? "").trim() || null,
        },
      });
      return dataWithSuccess(null, "Household pickup context updated.");
    }

    if (intent === "assign") {
      const householdId = String(formData.get("householdId") ?? "");
      const studentIds = parseStudentIds(formData);
      if (!householdId || studentIds.length === 0) {
        return dataWithError(null, "Choose a household and at least one student.");
      }

      await prisma.student.updateMany({
        where: { id: { in: studentIds } },
        data: { householdId },
      });
      return dataWithSuccess(null, "Student assignment updated.");
    }

    if (intent === "detach") {
      const studentId = Number(formData.get("studentId"));
      if (!Number.isInteger(studentId)) {
        return dataWithError(null, "Invalid student.");
      }
      await prisma.student.update({
        where: { id: studentId },
        data: { householdId: null },
      });
      return dataWithWarning(null, "Student removed from household.");
    }

    if (intent === "delete") {
      const householdId = String(formData.get("householdId") ?? "");
      if (!householdId) {
        return dataWithError(null, "Invalid household.");
      }
      await prisma.student.updateMany({
        where: { householdId },
        data: { householdId: null },
      });
      await prisma.household.delete({ where: { id: householdId } });
      return dataWithWarning(null, "Household deleted; students were left on the roster.");
    }
  } catch (error) {
    console.error("household action failed", error);
    return dataWithError(null, error instanceof Error ? error.message : "Household update failed.");
  }

  return dataWithError(null, "Unknown household action.");
}

export default function AdminHouseholds({ loaderData }: Route.ComponentProps) {
  const { households, unassignedStudents, allStudents } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Households</h1>
          <p className="text-sm text-white/60">
            Group siblings and capture shared pickup notes that admins can see at a glance.
          </p>
        </div>
        <Link to="/admin/exceptions" className="text-sm text-blue-300 hover:text-blue-200">
          Manage recurring exceptions
        </Link>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-300" />
            <h2 className="font-semibold text-white">Create a household</h2>
          </div>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="create" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="name" label="Household name" placeholder="Garcia household" />
              <Input name="primaryContactName" label="Primary pickup contact" placeholder="Optional" />
              <Input name="primaryContactPhone" label="Contact phone" placeholder="Optional" />
            </div>
            <Textarea
              name="pickupNotes"
              label="Shared pickup context"
              placeholder="Example: both siblings leave together on car line unless there is an active exception."
            />
            <StudentCheckboxList students={unassignedStudents} emptyText="No unassigned students. Detach a student from another household first." />
            <Button type="submit" variant="primary" className="self-start">
              Create household
            </Button>
          </Form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-semibold text-white">Assign existing students</h2>
          <p className="mt-1 text-sm text-white/50">
            Use this when a new sibling is added after the household already exists.
          </p>
          <Form method="post" className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="intent" value="assign" />
            <label className="flex flex-col gap-1 text-xs text-white/60">
              Household
              <select
                name="householdId"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
              >
                <option value="">Choose household</option>
                {households.map((household) => (
                  <option key={household.id} value={household.id}>
                    {household.name}
                  </option>
                ))}
              </select>
            </label>
            <StudentCheckboxList students={allStudents} emptyText="No students yet." compact />
            <Button type="submit" variant="secondary">
              Assign selected
            </Button>
          </Form>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {households.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
            No households yet. Create one above to start grouping siblings.
          </div>
        ) : (
          households.map((household) => (
            <HouseholdCard key={household.id} household={household} />
          ))
        )}
      </section>
    </div>
  );
}

function StudentCheckboxList({
  students,
  emptyText,
  compact = false,
}: {
  students: {
    id: number;
    firstName: string;
    lastName: string;
    homeRoom?: string | null;
    spaceNumber?: number | null;
    householdId?: string | null;
  }[];
  emptyText: string;
  compact?: boolean;
}) {
  if (students.length === 0) {
    return <p className="rounded-lg bg-black/20 p-3 text-sm text-white/45">{emptyText}</p>;
  }

  return (
    <div className={`grid gap-2 ${compact ? "max-h-56 overflow-y-auto" : "sm:grid-cols-2"}`}>
      {students.map((student) => (
        <label
          key={student.id}
          className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white"
        >
          <input type="checkbox" name="studentIds" value={student.id} className="mt-1" />
          <span>
            <span className="font-medium">{studentDisplayName(student)}</span>
            <span className="block text-xs text-white/45">
              {student.homeRoom ? `${student.homeRoom} · ` : ""}
              {student.spaceNumber ? `Space ${student.spaceNumber}` : "No space"}
              {student.householdId ? " · currently grouped" : ""}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function HouseholdCard({
  household,
}: {
  household: {
    id: string;
    name: string;
    pickupNotes: string | null;
    primaryContactName: string | null;
    primaryContactPhone: string | null;
    students: {
      id: number;
      firstName: string;
      lastName: string;
      homeRoom: string | null;
      spaceNumber: number | null;
    }[];
    exceptions: { id: string; dismissalPlan: string; scheduleKind: string }[];
  };
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Home className="h-5 w-5 text-blue-300" />
            <h2 className="text-lg font-semibold text-white">{household.name}</h2>
          </div>
          <p className="mt-1 text-sm text-white/50">
            {household.students.length} {household.students.length === 1 ? "student" : "students"}
            {household.exceptions.length > 0 ? ` · ${household.exceptions.length} active exception${household.exceptions.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="householdId" value={household.id} />
          <Button type="submit" variant="danger" size="sm">
            Delete
          </Button>
        </Form>
      </div>

      <Form method="post" className="mb-5 grid gap-3">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="householdId" value={household.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="name" label="Household name" defaultValue={household.name} required />
          <Input name="primaryContactName" label="Primary contact" defaultValue={household.primaryContactName ?? ""} />
          <Input name="primaryContactPhone" label="Contact phone" defaultValue={household.primaryContactPhone ?? ""} />
        </div>
        <Textarea name="pickupNotes" label="Pickup notes" defaultValue={household.pickupNotes ?? ""} />
        <Button type="submit" variant="secondary" size="sm" className="justify-self-start">
          Save pickup context
        </Button>
      </Form>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {household.students.length === 0 ? (
          <p className="p-4 text-sm text-white/45">No students assigned.</p>
        ) : (
          household.students.map((student) => (
            <div
              key={student.id}
              className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-3 first:border-t-0"
            >
              <div>
                <p className="font-medium text-white">{studentDisplayName(student)}</p>
                <p className="text-xs text-white/45">
                  {student.homeRoom ?? "No homeroom"} · {student.spaceNumber ? `Space ${student.spaceNumber}` : "No space"}
                </p>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="detach" />
                <input type="hidden" name="studentId" value={student.id} />
                <Button type="submit" variant="ghost" size="sm">
                  <UserMinus className="h-4 w-4" />
                  Detach
                </Button>
              </Form>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
