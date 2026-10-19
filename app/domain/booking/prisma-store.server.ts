import { dayKeyFromParts, zonedParts, type BookingKind } from "./rules";
import type { BookingRecord, BookingStore } from "./store";

function asRecord(row: any): BookingRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    slotKey: row.slotKey ?? null,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    name: row.name,
    email: row.email,
    role: row.role ?? null,
    school: row.school ?? null,
    phone: row.phone ?? null,
    studentCount: row.studentCount ?? null,
    message: row.message ?? null,
    visitorTimeZone: row.visitorTimeZone,
    sequence: row.sequence ?? 0,
  };
}

/** Unscoped Prisma client. Booking is not a tenant model. */
export function bookingStoreFromPrisma(prisma: any): BookingStore {
  return {
    async create(data) {
      const row = await prisma.booking.create({ data });
      return asRecord(row);
    },
    async countConfirmed({ dayStart, dayEnd, exceptId }) {
      return prisma.booking.count({
        where: {
          status: "confirmed",
          startsAt: { gte: dayStart, lt: dayEnd },
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
      });
    },
    async release(id, when) {
      await prisma.booking.update({
        where: { id },
        data: { status: "cancelled", slotKey: null, cancelledAt: when },
      });
    },
    async move(id, data) {
      await prisma.booking.update({ where: { id }, data });
    },
    async cancel(id, when, sequence) {
      await prisma.booking.update({
        where: { id },
        data: {
          status: "cancelled",
          slotKey: null,
          cancelledAt: when,
          sequence,
        },
      });
    },
    async findById(id) {
      const row = await prisma.booking.findUnique({ where: { id } });
      return row ? asRecord(row) : null;
    },
    async takenStarts(from: Date, to: Date) {
      const rows = await prisma.booking.findMany({
        where: {
          status: "confirmed",
          startsAt: { gte: from, lte: to },
        },
        select: { startsAt: true },
      });
      return rows.map((row: { startsAt: Date }) => new Date(row.startsAt));
    },
    async countsByDay(timeZone: string, from: Date, to: Date) {
      const rows = await prisma.booking.findMany({
        where: {
          status: "confirmed",
          startsAt: { gte: from, lte: to },
        },
        select: { startsAt: true },
      });
      const counts = new Map<string, number>();
      for (const row of rows as { startsAt: Date }[]) {
        const key = dayKeyFromParts(zonedParts(new Date(row.startsAt), timeZone));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    },
  };
}

export type { BookingKind };
