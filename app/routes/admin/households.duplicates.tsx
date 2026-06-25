import { Form, Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { redirectWithSuccess, redirectWithError } from "remix-toast";
import type { Route } from "./+types/households.duplicates";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { auditOrgAction } from "~/domain/org/audit.server";
import { chunkedFindMany } from "~/db/chunked-in";
import {
  groupDuplicateHouseholds,
  mergeHouseholdGroup,
  type HouseholdScalars,
} from "~/domain/households/merge.server";

type GroupHousehold = {
  id: string;
  name: string;
  spaceNumber: number;
  pickupNotes: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  createdAt: Date;
  students: { id: number; firstName: string; lastName: string }[];
};

type DuplicateGroup = {
  spaceNumber: number;
  households: GroupHousehold[];
};

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const households = await prisma.household.findMany({
    where: { spaceNumber: { not: null } },
    select: {
      id: true,
      name: true,
      spaceNumber: true,
      pickupNotes: true,
      primaryContactName: true,
      primaryContactPhone: true,
      createdAt: true,
    },
  });

  const groups = groupDuplicateHouseholds(
    households.map((h) => ({ id: h.id, spaceNumber: h.spaceNumber, createdAt: h.createdAt })),
  );

  // When the pre-fix importer ran, it could create hundreds of duplicate
  // households, so `involvedIds` is not statically bounded. A single
  // `householdId: { in: involvedIds }` overflows D1's bound-parameter cap
  // ("too many SQL variables"); chunk the IN list and stitch in JS.
  const involvedIds = groups.flat().map((h) => h.id);
  const students = await chunkedFindMany(involvedIds, (idChunk) =>
    prisma.student.findMany({
      where: { householdId: { in: idChunk } },
      select: { id: true, firstName: true, lastName: true, householdId: true },
      orderBy: { lastName: "asc" },
    }),
  );

  const studentsByHousehold = new Map<string, { id: number; firstName: string; lastName: string }[]>();
  for (const s of students) {
    if (!s.householdId) continue;
    const arr = studentsByHousehold.get(s.householdId) ?? [];
    arr.push({ id: s.id, firstName: s.firstName, lastName: s.lastName });
    studentsByHousehold.set(s.householdId, arr);
  }

  const byId = new Map(households.map((h) => [h.id, h]));
  const duplicateGroups: DuplicateGroup[] = groups.map((group) => ({
    spaceNumber: group[0].spaceNumber as number,
    households: group.map((g) => {
      const full = byId.get(g.id)!;
      return {
        id: full.id,
        name: full.name,
        spaceNumber: full.spaceNumber as number,
        pickupNotes: full.pickupNotes,
        primaryContactName: full.primaryContactName,
        primaryContactPhone: full.primaryContactPhone,
        createdAt: full.createdAt,
        students: studentsByHousehold.get(full.id) ?? [],
      };
    }),
  }));

  return { duplicateGroups };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const form = await request.formData();

  const survivorId = String(form.get("survivorId") ?? "");
  const losingIds = String(form.get("losingIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!survivorId || losingIds.length === 0) {
    return redirectWithError("/admin/households/duplicates", "Nothing to merge.");
  }

  // Guard against a crafted POST that lists the survivor among the losers —
  // mergeHouseholdGroup would reassign the survivor's rows to itself and then
  // delete it. The UI never does this, but the action must not trust the form.
  if (losingIds.includes(survivorId)) {
    return redirectWithError(
      "/admin/households/duplicates",
      "Invalid merge: the surviving household cannot also be a losing one.",
    );
  }

  const scalars: HouseholdScalars = {
    name: String(form.get("name") ?? "").trim() || "Household",
    pickupNotes: emptyToNull(form.get("pickupNotes")),
    primaryContactName: emptyToNull(form.get("primaryContactName")),
    primaryContactPhone: emptyToNull(form.get("primaryContactPhone")),
  };

  try {
    await mergeHouseholdGroup(prisma, { survivorId, losingIds, scalars });
  } catch (error) {
    console.error("household merge failed", error);
    return redirectWithError(
      "/admin/households/duplicates",
      error instanceof Error ? error.message : "Merge failed.",
    );
  }

  await auditOrgAction(context, request, {
    action: "household.merge",
    targetType: "household",
    targetId: survivorId,
    always: true,
    payload: { survivorId, losingIds, name: scalars.name },
  });
  return redirectWithSuccess("/admin/households/duplicates", "Households merged.");
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

export default function HouseholdDuplicates({ loaderData }: Route.ComponentProps) {
  const { duplicateGroups } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin/households"
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to households
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Duplicate households
        </h1>
        <p className="text-sm text-white/55">
          These pickup spaces have more than one household. Pick which value
          should win for each field, then merge. All children and dismissal
          exceptions move to the surviving household — nothing is lost.
        </p>
      </header>

      {duplicateGroups.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No duplicate households. 🎉
        </p>
      ) : (
        duplicateGroups.map((group) => (
          <DuplicateGroupCard key={group.spaceNumber} group={group} />
        ))
      )}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const survivor = group.households[0]; // oldest = default survivor
  const losingIds = group.households.slice(1).map((h) => h.id).join(",");

  return (
    <Form
      method="post"
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-5"
    >
      <input type="hidden" name="survivorId" value={survivor.id} />
      <input type="hidden" name="losingIds" value={losingIds} />

      <h2 className="text-sm font-semibold text-white">
        Space {group.spaceNumber} · {group.households.length} households
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {group.households.map((h) => (
          <div key={h.id} className="rounded-lg border border-white/10 p-3">
            <p className="text-sm font-medium text-white">{h.name}</p>
            <p className="text-xs text-white/50">
              {h.students.length} student{h.students.length === 1 ? "" : "s"}:{" "}
              {h.students.map((s) => `${s.firstName} ${s.lastName}`).join(", ") || "—"}
            </p>
          </div>
        ))}
      </div>

      <FieldChooser label="Household name" field="name" group={group} />
      <FieldChooser label="Pickup notes" field="pickupNotes" group={group} />
      <FieldChooser label="Primary contact" field="primaryContactName" group={group} />
      <FieldChooser label="Contact phone" field="primaryContactPhone" group={group} />

      <button
        type="submit"
        className="self-start rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400"
      >
        Merge into one household
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
  field: "name" | "pickupNotes" | "primaryContactName" | "primaryContactPhone";
  group: DuplicateGroup;
}) {
  // Distinct candidate values across the group; survivor's value is the default.
  const values: string[] = [];
  for (const h of group.households) {
    const v = (h[field] ?? "").toString();
    if (!values.includes(v)) values.push(v);
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium uppercase tracking-wide text-white/45">
        {label}
      </legend>
      {values.map((v, i) => (
        <label key={`${field}-${i}`} className="flex items-center gap-2 text-sm text-white/80">
          <input type="radio" name={field} value={v} defaultChecked={i === 0} />
          <span>{v === "" ? <span className="text-white/40">(empty)</span> : v}</span>
        </label>
      ))}
    </fieldset>
  );
}
