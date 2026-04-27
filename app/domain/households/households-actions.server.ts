import type { PrismaClient } from "~/db";
import type {
  ServerMessage,
  ServerResult,
} from "~/domain/types/server-message";
import {
  parseDateOnly,
  parseOptionalDateOnly,
  toDateInputValue,
} from "~/domain/dismissal/schedule";
import { chunk, chunkedFindMany } from "~/db/chunked-in";
import {
  defaultHouseholdName,
  parseStudentIds,
} from "./households";

/**
 * Translation-ready action handlers for the households admin route.
 *
 * Lives in its own `.server.ts` because the sister `households.server.ts`
 * exports pure utilities that the route component bundles into the client
 * (e.g. `studentDisplayName`). Adding a Prisma type import there would
 * trip React Router's "server module referenced by client" guard. Keeping
 * the action surface here lets the route action import these wrappers
 * without dragging the client bundle along for the ride.
 *
 * Each public handler returns a `ServerResult<T>` per the contract in
 * `app/domain/types/server-message.ts`. The route boundary calls
 * `t(message.key, message.params ?? {})` to resolve the toast/error in
 * the active locale.
 */

/**
 * Subset of `PrismaClient` the household action handlers touch. Defining a
 * narrow surface keeps the route boundary's mocking story sane and avoids
 * accidentally widening what these handlers can do.
 */
export type HouseholdsPrisma = Pick<
  PrismaClient,
  | "household"
  | "student"
  | "dismissalException"
  | "afterSchoolProgram"
  | "programCancellation"
>;

export type CreateHouseholdArgs = {
  prisma: HouseholdsPrisma;
  orgId: string;
  formData: FormData;
};

export type CreateHouseholdSuccess = {
  householdId: string;
  householdName: string;
};

/**
 * Create a household and assign the selected students to it. Returns a
 * translation-ready `ServerResult` — see
 * `app/domain/types/server-message.ts`.
 */
export async function createHousehold({
  prisma,
  orgId,
  formData,
}: CreateHouseholdArgs): Promise<ServerResult<CreateHouseholdSuccess>> {
  const studentIds = parseStudentIds(formData);
  if (studentIds.length === 0) {
    return errorResult("errors:households.chooseAtLeastOneStudent");
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
    return errorResult("errors:households.noMatchingStudents");
  }

  const requestedName = String(formData.get("name") ?? "").trim();
  const household = await prisma.household.create({
    data: {
      orgId,
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

  return {
    ok: true,
    data: { householdId: household.id, householdName: household.name },
    successMessage: {
      key: "errors:households.createdSuccess",
      params: { name: household.name },
    },
  };
}

export type UpdateHouseholdArgs = {
  prisma: HouseholdsPrisma;
  formData: FormData;
};

export async function updateHousehold({
  prisma,
  formData,
}: UpdateHouseholdArgs): Promise<ServerResult<null>> {
  const householdId = String(formData.get("householdId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!householdId || !name) {
    return errorResult("errors:households.nameRequired");
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
  return {
    ok: true,
    data: null,
    successMessage: { key: "errors:households.contextUpdated" },
  };
}

export type AssignStudentsArgs = {
  prisma: HouseholdsPrisma;
  formData: FormData;
};

export async function assignStudentsToHousehold({
  prisma,
  formData,
}: AssignStudentsArgs): Promise<ServerResult<null>> {
  const householdId = String(formData.get("householdId") ?? "");
  const studentIds = parseStudentIds(formData);
  if (!householdId || studentIds.length === 0) {
    return errorResult("errors:households.chooseHouseholdAndStudents");
  }

  for (const idChunk of chunk(studentIds)) {
    await prisma.student.updateMany({
      where: { id: { in: idChunk } },
      data: { householdId },
    });
  }
  return {
    ok: true,
    data: null,
    successMessage: { key: "errors:households.assignmentUpdated" },
  };
}

export type DetachStudentArgs = {
  prisma: HouseholdsPrisma;
  formData: FormData;
};

export async function detachStudentFromHousehold({
  prisma,
  formData,
}: DetachStudentArgs): Promise<ServerResult<null>> {
  const studentId = Number(formData.get("studentId"));
  if (!Number.isInteger(studentId)) {
    return errorResult("errors:households.invalidStudent");
  }

  await prisma.student.update({
    where: { id: studentId },
    data: { householdId: null },
  });
  return {
    ok: true,
    data: null,
    successMessage: { key: "errors:households.studentDetached" },
  };
}

export type DeleteHouseholdArgs = {
  prisma: HouseholdsPrisma;
  formData: FormData;
};

export async function deleteHousehold({
  prisma,
  formData,
}: DeleteHouseholdArgs): Promise<ServerResult<null>> {
  const householdId = String(formData.get("householdId") ?? "");
  if (!householdId) {
    return errorResult("errors:households.invalidHousehold");
  }

  await prisma.student.updateMany({
    where: { householdId },
    data: { householdId: null },
  });
  await prisma.household.delete({ where: { id: householdId } });
  return {
    ok: true,
    data: null,
    successMessage: { key: "errors:households.deleted" },
  };
}

export type CreateExceptionArgs = {
  prisma: HouseholdsPrisma;
  orgId: string;
  formData: FormData;
};

export async function createDismissalException({
  prisma,
  orgId,
  formData,
}: CreateExceptionArgs): Promise<ServerResult<{ exceptionId: string }>> {
  const householdId = String(formData.get("householdId") ?? "").trim();
  const scheduleKind =
    String(formData.get("scheduleKind") ?? "DATE").toUpperCase() === "WEEKLY"
      ? "WEEKLY"
      : "DATE";
  const dismissalPlan = String(formData.get("dismissalPlan") ?? "").trim();

  if (!householdId || !dismissalPlan) {
    return errorResult("errors:households.exceptionRequiresHouseholdAndPlan");
  }

  let exceptionDate: Date | null = null;
  let dayOfWeek: number | null = null;
  let startsOn: Date | null = null;
  let endsOn: Date | null = null;

  try {
    if (scheduleKind === "DATE") {
      exceptionDate = parseDateOnly(
        String(formData.get("exceptionDate") ?? ""),
        "Exception date",
      );
    } else {
      dayOfWeek = Number(formData.get("dayOfWeek"));
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        return errorResult("errors:households.weeklyRequiresWeekday");
      }
      startsOn = parseOptionalDateOnly(
        String(formData.get("startsOn") ?? ""),
        "Starts on",
      );
      endsOn = parseOptionalDateOnly(
        String(formData.get("endsOn") ?? ""),
        "Ends on",
      );
      if (startsOn && endsOn && startsOn.getTime() > endsOn.getTime()) {
        return errorResult("errors:households.endsBeforeStarts");
      }
    }
  } catch (error) {
    // parseDateOnly throws Error("<label> must be ..."); surface a generic
    // translated message rather than the raw English label.
    return errorResult("errors:households.invalidDate", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const exception = await prisma.dismissalException.create({
    data: {
      orgId,
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

  return {
    ok: true,
    data: { exceptionId: exception.id },
    successMessage: { key: "errors:households.exceptionSaved" },
  };
}

export type DeactivateExceptionArgs = {
  prisma: HouseholdsPrisma;
  formData: FormData;
};

export async function deactivateDismissalException({
  prisma,
  formData,
}: DeactivateExceptionArgs): Promise<ServerResult<null>> {
  const exceptionId = String(formData.get("exceptionId") ?? "").trim();
  if (!exceptionId) {
    return errorResult("errors:households.invalidException");
  }

  await prisma.dismissalException.update({
    where: { id: exceptionId },
    data: { isActive: false },
  });
  return {
    ok: true,
    data: null,
    successMessage: { key: "errors:households.exceptionArchived" },
  };
}

export type CreateCancellationArgs = {
  prisma: HouseholdsPrisma;
  orgId: string;
  formData: FormData;
};

export type CreateCancellationSuccess = {
  cancellationId: string;
  cancellationDate: string;
  programName: string;
  title: string;
  message: string;
};

export async function createProgramCancellation({
  prisma,
  orgId,
  formData,
}: CreateCancellationArgs): Promise<ServerResult<CreateCancellationSuccess>> {
  const programId = String(formData.get("programId") ?? "").trim();
  const programNameInput = String(formData.get("programName") ?? "").trim();
  let cancellationDate: Date;
  try {
    cancellationDate = parseDateOnly(
      String(formData.get("cancellationDate") ?? ""),
      "Cancellation date",
    );
  } catch (error) {
    return errorResult("errors:households.invalidDate", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const title = String(formData.get("title") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!programId && !programNameInput) {
    return errorResult("errors:households.programRequired");
  }
  if (!title || !message) {
    return errorResult("errors:households.titleAndMessageRequired");
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
        orgId,
        name: programNameInput,
        isActive: true,
      },
      select: { id: true, name: true },
    });
  }

  if (!program) {
    return errorResult("errors:households.programUnresolved");
  }

  const cancellation = await prisma.programCancellation.create({
    data: {
      orgId,
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

  return {
    ok: true,
    data: {
      cancellationId: cancellation.id,
      cancellationDate: toDateInputValue(cancellation.cancellationDate),
      programName: program.name,
      title,
      message,
    },
    successMessage: {
      key: "errors:households.cancellationSent",
      params: { name: program.name },
    },
  };
}

function errorResult(
  key: string,
  params?: Record<string, string | number>,
): { ok: false; error: ServerMessage } {
  return { ok: false, error: { key, params } };
}
