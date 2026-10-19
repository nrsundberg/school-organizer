import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { reserveBooking, type BookingRecord, type BookingStore } from "./store";

function memoryStore(): BookingStore & { rows: BookingRecord[] } {
  const rows: BookingRecord[] = [];
  const store: BookingStore & { rows: BookingRecord[] } = {
    rows,
    async create(data) {
      if (rows.some((row) => row.slotKey === data.slotKey)) {
        const err = new Error("UNIQUE constraint failed: Booking.slotKey");
        throw err;
      }
      const row: BookingRecord = {
        id: `b${rows.length + 1}`,
        kind: data.kind,
        status: "confirmed",
        slotKey: data.slotKey,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        name: data.name,
        email: data.email,
        role: data.role,
        school: data.school,
        phone: data.phone,
        studentCount: data.studentCount,
        message: data.message,
        visitorTimeZone: data.visitorTimeZone,
        sequence: 0,
      };
      rows.push(row);
      return row;
    },
    async countConfirmed({ dayStart, dayEnd, exceptId }) {
      return rows.filter(
        (row) =>
          row.status === "confirmed" &&
          row.id !== exceptId &&
          row.startsAt >= dayStart &&
          row.startsAt < dayEnd,
      ).length;
    },
    async release(id) {
      const row = rows.find((item) => item.id === id);
      if (!row) return;
      row.status = "cancelled";
      row.slotKey = null;
    },
    async move() {},
    async cancel() {},
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async takenStarts() {
      return [];
    },
    async countsByDay() {
      return new Map();
    },
  };
  return store;
}

const input = {
  kind: "demo" as const,
  startsAt: new Date("2027-01-05T16:00:00.000Z"),
  endsAt: new Date("2027-01-05T16:30:00.000Z"),
  name: "Ada",
  email: "ada@school.edu",
  role: "Principal",
  school: "Maple",
  phone: null,
  studentCount: null,
  message: null,
  visitorTimeZone: "America/New_York",
  dayKey: "2027-01-05",
  scheduleTimeZone: "America/Denver",
  maxPerDay: 1,
};

test("reserveBooking refuses a second booking for the same slot", async () => {
  const store = memoryStore();
  const first = await reserveBooking(store, input);
  const second = await reserveBooking(store, { ...input, email: "other@school.edu" });
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, error: "taken" });
  assert.equal(store.rows.filter((row) => row.status === "confirmed").length, 1);
});

test("reserveBooking releases the row when the day is already full", async () => {
  const store = memoryStore();
  await reserveBooking(store, input);
  const later = await reserveBooking(store, {
    ...input,
    startsAt: new Date("2027-01-05T16:45:00.000Z"),
    endsAt: new Date("2027-01-05T17:15:00.000Z"),
    email: "other@school.edu",
    maxPerDay: 1,
  });
  assert.deepEqual(later, { ok: false, error: "full" });
  assert.equal(store.rows.filter((row) => row.status === "confirmed").length, 1);
});

test("the booking unique index rejects a second confirmed slot and allows nulls", async () => {
  const sql = await readFile(
    path.resolve(import.meta.dirname, "../../../migrations/0044_booking.sql"),
    "utf8",
  );
  const db = createClient({ url: ":memory:" });
  try {
    for (const raw of sql.split(/;\s*\n/)) {
      const statement = raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (statement) await db.execute(statement);
    }
    const insert = (id: string, slotKey: string | null) =>
      db.execute({
        sql: `INSERT INTO "Booking" ("id","kind","status","slotKey","startsAt","endsAt","name","email","visitorTimeZone")
              VALUES (?, 'demo', 'confirmed', ?, '2027-01-05 16:00:00', '2027-01-05 16:30:00', 'Ada', 'ada@school.edu', 'America/Denver')`,
        args: [id, slotKey],
      });
    await insert("a", "2027-01-05T16:00:00.000Z");
    await assert.rejects(() => insert("b", "2027-01-05T16:00:00.000Z"));
    await insert("c", null);
    await insert("d", null);
  } finally {
    db.close();
  }
});
