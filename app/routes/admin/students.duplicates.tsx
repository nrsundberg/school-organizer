import { Form, Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { redirectWithSuccess, redirectWithError } from "remix-toast";
import type { Route } from "./+types/students.duplicates";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  groupDuplicateStudents,
  mergeStudentGroup,
  type StudentScalars,
} from "~/domain/students/merge.server";

type GroupStudent = {
  id: number;
  firstName: string;
  lastName: string;
  suffix: string | null;
  homeRoom: string | null;
  householdId: string | null;
  householdLabel: string;
  callEvents: number;
  exceptions: number;
};

type DuplicateGroup = {
  key: string;
  name: string;
  students: GroupStudent[];
};

function householdLabel(
  household: { name: string; spaceNumber: number | null } | null,
): string {
  if (!household) return "Unassigned";
  if (household.spaceNumber != null) {
    return `Space ${household.spaceNumber} · ${household.name}`;
  }
  return household.name;
}

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const students = await prisma.student.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      suffix: true,
      homeRoom: true,
      householdId: true,
      household: { select: { name: true, spaceNumber: true } },
      _count: { select: { callEvents: true, dismissalExceptions: true } },
    },
  });

  const groups = groupDuplicateStudents(
    students.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName })),
  );

  const byId = new Map(students.map((s) => [s.id, s]));
  const duplicateGroups: DuplicateGroup[] = groups.map((group) => {
    const full = group.map((g) => byId.get(g.id)!);
    const head = full[0];
    return {
      key: String(head.id),
      name: `${head.firstName} ${head.lastName}`.trim(),
      students: full.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        suffix: s.suffix,
        homeRoom: s.homeRoom,
        householdId: s.householdId,
        householdLabel: householdLabel(s.household),
        callEvents: s._count.callEvents,
        exceptions: s._count.dismissalExceptions,
      })),
    };
  });

  return { duplicateGroups };
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const form = await request.formData();

  const survivorId = Number(form.get("survivorId"));
  const losingIds = String(form.get("losingIds") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!Number.isInteger(survivorId) || survivorId <= 0 || losingIds.length === 0) {
    return redirectWithError("/admin/students/duplicates", "Nothing to merge.");
  }
  if (losingIds.includes(survivorId)) {
    return redirectWithError(
      "/admin/students/duplicates",
      "Invalid merge: the surviving student cannot also be a losing one.",
    );
  }

  // Only operate on students in this org, and only let the chosen homeroom /
  // household come from the records actually being merged — never trust an
  // arbitrary value from a crafted POST.
  const involved = await prisma.student.findMany({
    where: { id: { in: [survivorId, ...losingIds] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      suffix: true,
      homeRoom: true,
      householdId: true,
    },
  });
  const survivor = involved.find((s) => s.id === survivorId);
  if (!survivor || involved.length !== losingIds.length + 1) {
    return redirectWithError(
      "/admin/students/duplicates",
      "Some selected students no longer exist. Refresh and try again.",
    );
  }

  const allowedHomeRooms = new Set(involved.map((s) => s.homeRoom));
  const allowedHouseholds = new Set(involved.map((s) => s.householdId));
  const chosenHomeRoom = emptyToNull(form.get("homeRoom"));
  const chosenHousehold = emptyToNull(form.get("householdId"));

  const scalars: StudentScalars = {
    firstName: survivor.firstName,
    lastName: survivor.lastName,
    suffix: emptyToNull(form.get("suffix")),
    homeRoom: allowedHomeRooms.has(chosenHomeRoom) ? chosenHomeRoom : survivor.homeRoom,
    householdId: allowedHouseholds.has(chosenHousehold)
      ? chosenHousehold
      : survivor.householdId,
  };

  try {
    await mergeStudentGroup(prisma, { survivorId, losingIds, scalars });
  } catch (error) {
    console.error("student merge failed", error);
    return redirectWithError(
      "/admin/students/duplicates",
      error instanceof Error ? error.message : "Merge failed.",
    );
  }

  return redirectWithSuccess("/admin/students/duplicates", "Students merged.");
}

export default function StudentDuplicates({ loaderData }: Route.ComponentProps) {
  const { duplicateGroups } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin/children"
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to children
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Duplicate students
        </h1>
        <p className="text-sm text-white/55">
          These children share a name and may be the same student entered twice.
          Pick which record survives and which homeroom and household it keeps,
          then merge. All pickup history and dismissal exceptions move to the
          surviving record — nothing is lost. Check the history counts to be sure
          you're not merging real twins.
        </p>
      </header>

      {duplicateGroups.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No duplicate students. 🎉
        </p>
      ) : (
        duplicateGroups.map((group) => (
          <DuplicateGroupCard key={group.key} group={group} />
        ))
      )}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const survivor = group.students[0]; // lowest id = default survivor
  const losingIds = group.students
    .slice(1)
    .map((s) => s.id)
    .join(",");

  return (
    <Form
      method="post"
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-5"
    >
      <input type="hidden" name="survivorId" value={survivor.id} />
      <input type="hidden" name="losingIds" value={losingIds} />

      <h2 className="text-sm font-semibold text-white">
        {group.name} · {group.students.length} records
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {group.students.map((s) => (
          <div key={s.id} className="rounded-lg border border-white/10 p-3">
            <p className="text-sm font-medium text-white">
              {s.firstName} {s.lastName}
              {s.suffix ? ` ${s.suffix}` : ""}
            </p>
            <p className="text-xs text-white/50">
              {s.homeRoom ?? "No homeroom"} · {s.householdLabel}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {s.callEvents} pickup{s.callEvents === 1 ? "" : "s"} ·{" "}
              {s.exceptions} exception{s.exceptions === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>

      <FieldChooser label="Keep homeroom" field="homeRoom" group={group} />
      <FieldChooser label="Keep household" field="household" group={group} />
      <FieldChooser label="Keep suffix" field="suffix" group={group} />

      <button
        type="submit"
        className="self-start rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400"
      >
        Merge into one record
      </button>
    </Form>
  );
}

function FieldChooser({
  label,
  field,
  group,
}: {
  label: string;
  field: "homeRoom" | "household" | "suffix";
  group: DuplicateGroup;
}) {
  // Distinct (value, display) candidates across the group. For household the
  // submitted value is the householdId but we show a friendly label.
  const options: { value: string; display: string }[] = [];
  const seen = new Set<string>();
  for (const s of group.students) {
    let value: string;
    let display: string;
    if (field === "homeRoom") {
      value = s.homeRoom ?? "";
      display = s.homeRoom ?? "(no homeroom)";
    } else if (field === "household") {
      value = s.householdId ?? "";
      display = s.householdLabel;
    } else {
      value = s.suffix ?? "";
      display = s.suffix ?? "(none)";
    }
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, display });
  }

  const inputName = field === "household" ? "householdId" : field;

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium uppercase tracking-wide text-white/45">
        {label}
      </legend>
      {options.map((opt, i) => (
        <label
          key={`${field}-${i}`}
          className="flex items-center gap-2 text-sm text-white/80"
        >
          <input
            type="radio"
            name={inputName}
            value={opt.value}
            defaultChecked={i === 0}
          />
          <span>{opt.display}</span>
        </label>
      ))}
    </fieldset>
  );
}
