import invariant from "tiny-invariant";
import type { Route } from "./+types/data.students";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  assertUsageAllowsIncrement,
  countOrgUsage,
  PlanLimitError,
  syncUsageGracePeriod,
} from "~/domain/billing/plan-usage.server";
import { dataWithError, dataWithSuccess } from "remix-toast";
import { parseStudentRoster } from "~/domain/csv/student-roster.server";

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);

  // Use native Web API for multipart form data (works on Cloudflare Workers)
  const formData = await request.formData();
  const file = formData.get("file");
  invariant(file instanceof File, "Must include file");

  // Parse, size-cap, row-cap, header-validate, and Zod-validate in one call.
  const parseResult = await parseStudentRoster(file);
  if (!parseResult.ok) {
    const detail =
      parseResult.rowErrors && parseResult.rowErrors.length > 0
        ? parseResult.rowErrors
            .slice(0, 5)
            .map((e) => `Row ${e.row}: ${e.message}`)
            .join("; ")
        : "";
    const message = detail
      ? `${parseResult.error} ${detail}${
          parseResult.rowErrors!.length > 5
            ? ` (+${parseResult.rowErrors!.length - 5} more)`
            : ""
        }`
      : parseResult.error;
    return dataWithError({ result: "invalid" }, message);
  }

  const allCsvData = parseResult.rows;

  const homeRooms = new Set(allCsvData.map((row) => row.Homeroom));
  let newClassrooms = 0;
  for (const room of homeRooms) {
    const exists = await prisma.teacher.findFirst({
      where: { homeRoom: room },
    });
    if (!exists) {
      newClassrooms += 1;
    }
  }

  const rowCount = allCsvData.length;
  const counts = await countOrgUsage(prisma, org.id);
  try {
    assertUsageAllowsIncrement(org, counts, {
      students: rowCount,
      families: rowCount,
      classrooms: newClassrooms,
    });
  } catch (e) {
    if (e instanceof PlanLimitError) {
      return dataWithError({ result: "blocked" }, e.message);
    }
    throw e;
  }

  for (const room of homeRooms) {
    const exists = await prisma.teacher.findFirst({
      where: { homeRoom: room },
    });
    if (!exists) {
      await prisma.teacher.create({ data: { homeRoom: room } });
    }
  }

  const rows = allCsvData.map((row) => ({
    firstName: row.First,
    lastName: row["Last Name"],
    spaceNumber: row["Carline Number"],
    homeRoom: row.Homeroom,
  }));

  const CHUNK_SIZE = 50;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await prisma.student.createMany({
      data: rows.slice(i, i + CHUNK_SIZE),
    });
  }

  const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
  if (freshOrg) {
    const nextCounts = await countOrgUsage(prisma, org.id);
    await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
  }

  const skipNote =
    parseResult.skippedBlank > 0
      ? ` (skipped ${parseResult.skippedBlank} blank row${parseResult.skippedBlank === 1 ? "" : "s"})`
      : "";

  return dataWithSuccess(
    { result: "Created student records from csv" },
    { message: `Created ${rows.length} student records from csv${skipNote}` }
  );
}
