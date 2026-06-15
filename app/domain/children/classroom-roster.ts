/**
 * Builds the per-classroom roster AND count from a single pass over one
 * student array. Keeping both outputs derived from the same input is the whole
 * point: the classrooms page used to compute the count from all students but
 * the expandable roster from search-filtered students, so a stale `?q=` made a
 * card claim "N students" yet expand to "no kids". Sharing one source makes
 * `countByRoom.get(room) === studentsByRoom.get(room).length` a structural
 * invariant they cannot diverge from.
 *
 * Pure — no server imports — so the bundler ships it to the client cleanly.
 */

export type RosterStudent = {
  id: number;
  firstName: string;
  lastName: string;
  homeRoom: string | null;
};

export type RoomIndex<T extends RosterStudent> = {
  studentsByRoom: Map<string, T[]>;
  countByRoom: Map<string, number>;
};

export function buildRoomIndex<T extends RosterStudent>(students: T[]): RoomIndex<T> {
  const studentsByRoom = new Map<string, T[]>();
  for (const s of students) {
    if (!s.homeRoom) continue;
    const arr = studentsByRoom.get(s.homeRoom) ?? [];
    arr.push(s);
    studentsByRoom.set(s.homeRoom, arr);
  }
  const countByRoom = new Map<string, number>();
  for (const [room, arr] of studentsByRoom) countByRoom.set(room, arr.length);
  return { studentsByRoom, countByRoom };
}
