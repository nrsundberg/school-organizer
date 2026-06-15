/**
 * Household duplicate detection + merge.
 *
 * Identity for dedup is the pickup `spaceNumber` ONLY (per the roster-import
 * design): every student on a space belongs to one household. Households with a
 * null space are never considered duplicates of each other.
 *
 * These functions are prisma-agnostic (structural types) so they unit-test
 * against simple fakes — see merge.server.test.ts.
 */

export type HouseholdLite = {
  id: string;
  spaceNumber: number | null;
  createdAt: Date;
};

/**
 * Group households that share a non-null space and have more than one member.
 * Each returned group is ordered oldest-first (by createdAt, then id) so the
 * caller can treat the first element as the default survivor.
 */
export function groupDuplicateHouseholds<T extends HouseholdLite>(households: T[]): T[][] {
  const bySpace = new Map<number, T[]>();
  for (const h of households) {
    if (h.spaceNumber == null) continue;
    const arr = bySpace.get(h.spaceNumber) ?? [];
    arr.push(h);
    bySpace.set(h.spaceNumber, arr);
  }
  return [...bySpace.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      [...group].sort((a, b) => {
        const t = a.createdAt.getTime() - b.createdAt.getTime();
        return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    );
}

export type HouseholdScalars = {
  name: string;
  pickupNotes: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
};

export type MergeHouseholdGroupInput = {
  survivorId: string;
  losingIds: string[];
  scalars: HouseholdScalars;
};

/** Structural slice of Prisma used by the merge. */
export type MergePrisma = {
  student: {
    updateMany: (args: {
      where: { householdId: string };
      data: { householdId: string };
    }) => Promise<unknown>;
  };
  dismissalException: {
    updateMany: (args: {
      where: { householdId: string };
      data: { householdId: string };
    }) => Promise<unknown>;
  };
  household: {
    update: (args: { where: { id: string }; data: HouseholdScalars }) => Promise<unknown>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
};

/**
 * Merge duplicate households into one survivor.
 *
 * Order matters and is intentional: D1 has no interactive transactions here, so
 * we reassign every loser's students and dismissal exceptions to the survivor
 * FIRST, then delete the losers LAST. Deleting first would trip the schema's
 * `onDelete` rules (Student.householdId -> SetNull, DismissalException -> Cascade)
 * and lose the very rows we mean to move.
 */
export async function mergeHouseholdGroup(
  prisma: MergePrisma,
  input: MergeHouseholdGroupInput,
): Promise<void> {
  // Never let the survivor appear among the losers — that would reassign its
  // rows to itself and then delete it. Defensive: callers should not do this.
  const losingIds = input.losingIds.filter((id) => id !== input.survivorId);
  for (const losingId of losingIds) {
    await prisma.student.updateMany({
      where: { householdId: losingId },
      data: { householdId: input.survivorId },
    });
    await prisma.dismissalException.updateMany({
      where: { householdId: losingId },
      data: { householdId: input.survivorId },
    });
  }
  await prisma.household.update({
    where: { id: input.survivorId },
    data: input.scalars,
  });
  await prisma.household.deleteMany({
    where: { id: { in: losingIds } },
  });
}
