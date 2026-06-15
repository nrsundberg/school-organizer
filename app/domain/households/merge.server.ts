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
