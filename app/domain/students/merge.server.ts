/**
 * Student duplicate detection + merge.
 *
 * Duplicates happen when the same child is entered twice — e.g. added by hand
 * and then again via a roster import, or imported into two different homerooms.
 * Identity for detection is the normalized (firstName + lastName) pair; the UI
 * surfaces homeroom / household / history counts alongside each match so an
 * admin can tell real twins apart before merging.
 *
 * These functions are prisma-agnostic (structural types) so they unit-test
 * against simple fakes — see merge.server.test.ts.
 */

export type StudentLite = {
  id: number;
  firstName: string;
  lastName: string;
};

function normalizeKeyPart(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Normalized identity used to group likely-duplicate students. */
export function studentDuplicateKey(
  student: Pick<StudentLite, "firstName" | "lastName">,
): string {
  return [normalizeKeyPart(student.firstName), normalizeKeyPart(student.lastName)].join(
    " ",
  );
}

/**
 * Group students that share a normalized name and have more than one member.
 * Student has no createdAt, so groups are ordered by id (lowest first) and the
 * caller treats the first element as the default survivor (the oldest record).
 */
export function groupDuplicateStudents<T extends StudentLite>(students: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const student of students) {
    const key = studentDuplicateKey(student);
    const arr = byKey.get(key) ?? [];
    arr.push(student);
    byKey.set(key, arr);
  }
  return [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.id - b.id));
}

/** Scalar fields copied onto the surviving student record. */
export type StudentScalars = {
  firstName: string;
  lastName: string;
  suffix: string | null;
  homeRoom: string | null;
  householdId: string | null;
};

export type MergeStudentGroupInput = {
  survivorId: number;
  losingIds: number[];
  scalars: StudentScalars;
};

/** Structural slice of Prisma used by the merge. */
export type MergeStudentPrisma = {
  callEvent: {
    updateMany: (args: {
      where: { studentId: number };
      data: { studentId: number };
    }) => Promise<unknown>;
  };
  dismissalException: {
    updateMany: (args: {
      where: { studentId: number };
      data: { studentId: number };
    }) => Promise<unknown>;
  };
  student: {
    update: (args: { where: { id: number }; data: StudentScalars }) => Promise<unknown>;
    deleteMany: (args: { where: { id: { in: number[] } } }) => Promise<unknown>;
  };
};

/**
 * Merge duplicate students into one survivor.
 *
 * Order matters and mirrors the household merge: D1 has no interactive
 * transactions here, so we reassign every loser's call events and dismissal
 * exceptions to the survivor FIRST, then delete the losers LAST. Deleting first
 * would trip the schema's onDelete rules (DismissalException -> Cascade would
 * delete the rows we mean to move; CallEvent -> SetNull would orphan history).
 */
export async function mergeStudentGroup(
  prisma: MergeStudentPrisma,
  input: MergeStudentGroupInput,
): Promise<void> {
  // Never let the survivor appear among the losers — that would reassign its
  // rows to itself and then delete it. Defensive: callers should not do this.
  const losingIds = input.losingIds.filter((id) => id !== input.survivorId);
  for (const losingId of losingIds) {
    await prisma.callEvent.updateMany({
      where: { studentId: losingId },
      data: { studentId: input.survivorId },
    });
    await prisma.dismissalException.updateMany({
      where: { studentId: losingId },
      data: { studentId: input.survivorId },
    });
  }
  await prisma.student.update({
    where: { id: input.survivorId },
    data: input.scalars,
  });
  await prisma.student.deleteMany({
    where: { id: { in: losingIds } },
  });
}
