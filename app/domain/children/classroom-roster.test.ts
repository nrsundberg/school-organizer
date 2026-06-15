import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRoomIndex, type RosterStudent } from "./classroom-roster";

type S = RosterStudent & { extra?: string };

const sample: S[] = [
  { id: 1, firstName: "Ann", lastName: "Apple", homeRoom: "Room A" },
  { id: 2, firstName: "Bob", lastName: "Berry", homeRoom: "Room A" },
  { id: 3, firstName: "Cleo", lastName: "Cherry", homeRoom: "Room B" },
  { id: 4, firstName: "Dan", lastName: "Date", homeRoom: null },
];

test("groups students by homeRoom and skips null homeRoom", () => {
  const { studentsByRoom } = buildRoomIndex(sample);
  assert.deepEqual(
    studentsByRoom.get("Room A")?.map((s) => s.id),
    [1, 2],
  );
  assert.deepEqual(
    studentsByRoom.get("Room B")?.map((s) => s.id),
    [3],
  );
  // Null-homeRoom student is not bucketed under any room.
  assert.equal(studentsByRoom.size, 2);
  for (const arr of studentsByRoom.values()) {
    assert.ok(arr.every((s) => s.homeRoom !== null));
  }
});

test("count for every room equals the roster length (regression guard)", () => {
  const { studentsByRoom, countByRoom } = buildRoomIndex(sample);
  // The invariant the bug violated: count and roster derive from the same set.
  for (const [room, roster] of studentsByRoom) {
    assert.equal(
      countByRoom.get(room),
      roster.length,
      `count for ${room} must equal roster length`,
    );
  }
  assert.equal(countByRoom.get("Room A"), 2);
  assert.equal(countByRoom.get("Room B"), 1);
  // countByRoom has no entry for rooms with no (non-null) students.
  assert.equal(countByRoom.size, studentsByRoom.size);
});

test("preserves input order within a room and carries extra fields", () => {
  const rows: S[] = [
    { id: 10, firstName: "Z", lastName: "Z", homeRoom: "R", extra: "keep" },
    { id: 11, firstName: "Y", lastName: "Y", homeRoom: "R" },
  ];
  const { studentsByRoom } = buildRoomIndex(rows);
  const roster = studentsByRoom.get("R")!;
  assert.deepEqual(roster.map((s) => s.id), [10, 11]);
  assert.equal(roster[0].extra, "keep");
});

test("empty input yields empty maps", () => {
  const { studentsByRoom, countByRoom } = buildRoomIndex<S>([]);
  assert.equal(studentsByRoom.size, 0);
  assert.equal(countByRoom.size, 0);
});
