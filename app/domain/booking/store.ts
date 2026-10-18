/**
 * Save, move, and cancel bookings.
 *
 * The unique `slotKey` is the lock: two confirmed bookings cannot share a
 * start. The insert runs first, then the daily cap is checked and the new
 * row is released if the day is already full. That order works on D1, which
 * does not offer interactive SQL transactions through Prisma.
 *
 * TODO(calendar): when Google Calendar busy-time sync lands, refuse a slot
 * that overlaps an external event before calling `reserveBooking`.
 */

import type { BookingKind } from "./rules";
import { dayWindow, slotKey } from "./rules";

export type BookingRecord = {
  id: string;
  kind: string;
  status: string;
  slotKey: string | null;
  startsAt: Date;
  endsAt: Date;
  name: string;
  email: string;
  role: string | null;
  school: string | null;
  phone: string | null;
  studentCount: string | null;
  message: string | null;
  visitorTimeZone: string;
  sequence: number;
};

export type NewBooking = {
  kind: BookingKind;
  startsAt: Date;
  endsAt: Date;
  name: string;
  email: string;
  role: string | null;
  school: string | null;
  phone: string | null;
  studentCount: string | null;
  message: string | null;
  visitorTimeZone: string;
  dayKey: string;
  scheduleTimeZone: string;
  maxPerDay: number;
};

export type BookingStore = {
  create(data: {
    slotKey: string;
    kind: string;
    startsAt: Date;
    endsAt: Date;
    name: string;
    email: string;
    role: string | null;
    school: string | null;
    phone: string | null;
    studentCount: string | null;
    message: string | null;
    visitorTimeZone: string;
  }): Promise<BookingRecord>;
  countConfirmed(args: {
    dayStart: Date;
    dayEnd: Date;
    exceptId?: string;
  }): Promise<number>;
  release(id: string, when: Date): Promise<void>;
  move(id: string, data: {
    slotKey: string;
    startsAt: Date;
    endsAt: Date;
    sequence: number;
  }): Promise<void>;
  cancel(id: string, when: Date, sequence: number): Promise<void>;
  findById(id: string): Promise<BookingRecord | null>;
  takenStarts(from: Date, to: Date): Promise<Date[]>;
  countsByDay(timeZone: string, from: Date, to: Date): Promise<Map<string, number>>;
};

export function isSlotTakenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === "P2002") return true;
  if (typeof candidate.message !== "string") return false;
  return (
    candidate.message.includes("Booking.slotKey") ||
    candidate.message.includes("Booking_slotKey_key") ||
    candidate.message.includes("UNIQUE constraint failed")
  );
}

export async function reserveBooking(
  store: BookingStore,
  input: NewBooking,
): Promise<{ ok: true; booking: BookingRecord } | { ok: false; error: "taken" | "full" }> {
  const key = slotKey(input.startsAt);
  let created: BookingRecord;
  try {
    created = await store.create({
      slotKey: key,
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      name: input.name,
      email: input.email,
      role: input.role,
      school: input.school,
      phone: input.phone,
      studentCount: input.studentCount,
      message: input.message,
      visitorTimeZone: input.visitorTimeZone,
    });
  } catch (err) {
    if (isSlotTakenError(err)) return { ok: false, error: "taken" };
    throw err;
  }

  const window = dayWindow(input.dayKey, input.scheduleTimeZone);
  const count = await store.countConfirmed({
    dayStart: window.start,
    dayEnd: window.end,
  });
  if (count > input.maxPerDay) {
    await store.release(created.id, new Date());
    return { ok: false, error: "full" };
  }
  return { ok: true, booking: created };
}

export async function moveBooking(
  store: BookingStore,
  current: BookingRecord,
  next: { startsAt: Date; endsAt: Date; dayKey: string; scheduleTimeZone: string; maxPerDay: number },
): Promise<{ ok: true } | { ok: false; error: "taken" | "full" | "closed" }> {
  if (current.status !== "confirmed") return { ok: false, error: "closed" };
  if (current.startsAt.getTime() === next.startsAt.getTime()) return { ok: true };
  const window = dayWindow(next.dayKey, next.scheduleTimeZone);
  const count = await store.countConfirmed({
    dayStart: window.start,
    dayEnd: window.end,
    exceptId: current.id,
  });
  if (count >= next.maxPerDay) return { ok: false, error: "full" };
  try {
    await store.move(current.id, {
      slotKey: slotKey(next.startsAt),
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      sequence: current.sequence + 1,
    });
  } catch (err) {
    if (isSlotTakenError(err)) return { ok: false, error: "taken" };
    throw err;
  }
  return { ok: true };
}
