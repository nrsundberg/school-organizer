/**
 * Most Recent Queue labeling and room filtering.
 *
 * A household call for a space shared by siblings is stored with
 * `studentId: null` and `studentName` set to the household name (for
 * example "Banerjee family"). Those rows belong in the queue. Dropping
 * them because `studentId` is null hid every sibling pickup.
 */

export type CallLabelStudent = {
  firstName: string;
  lastName: string;
  suffix?: string | null;
};

export function formatStudentCallName(student: CallLabelStudent): string {
  return [student.firstName, student.lastName, student.suffix].filter(Boolean).join(" ");
}

/**
 * Label shown in the queue.
 *
 * Single-student calls keep the stored student name. Household calls keep
 * the stored name and, when the children are known, append them:
 * `Banerjee family (Aarav Banerjee, Meera Banerjee)`.
 */
export function recentQueueLabel(input: {
  studentId: number | null;
  studentName: string;
  students: readonly CallLabelStudent[];
}): string {
  if (input.studentId != null) return input.studentName;
  const kids = input.students
    .map(formatStudentCallName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  if (kids.length === 0) return input.studentName;
  return `${input.studentName} (${kids.join(", ")})`;
}

export type RecentQueueEvent = {
  studentId: number | null;
  studentName: string;
  spaceNumber: number;
};

/** Rewrite household rows so the queue shows the stored name plus children. */
export function decorateRecentQueueEvents<T extends RecentQueueEvent>(
  events: readonly T[],
  studentsBySpace: ReadonlyMap<number, readonly CallLabelStudent[]>,
): T[] {
  return events.map((event) => {
    if (event.studentId != null) return event;
    return {
      ...event,
      studentName: recentQueueLabel({
        studentId: event.studentId,
        studentName: event.studentName,
        students: studentsBySpace.get(event.spaceNumber) ?? [],
      }),
    };
  });
}

/** Space numbers whose calls need a household lookup (no single student id). */
export function householdCallSpaceNumbers(
  events: readonly { studentId: number | null; spaceNumber: number }[],
): number[] {
  return [...new Set(events.filter((event) => event.studentId == null).map((event) => event.spaceNumber))];
}

/**
 * Same predicate as the loader's `homeRoomSnapshot IN (...)` filter.
 * An empty room list means "no filter". A household call snapshots a null
 * homeroom (siblings can sit in different rooms), so it shows on the
 * unfiltered queue and stays out of a single-room filter.
 */
export function callVisibleInRecentQueue(
  event: { homeRoomSnapshot: string | null },
  activeRooms: readonly string[],
): boolean {
  if (activeRooms.length === 0) return true;
  if (!event.homeRoomSnapshot) return false;
  return activeRooms.includes(event.homeRoomSnapshot);
}
