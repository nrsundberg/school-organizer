/**
 * Slot grid for demos and intro calls.
 *
 * Defaults: Monday–Friday, 9:00–16:00 America/Denver, 30-minute meetings,
 * 15 minutes of buffer after each one, 12 hours of notice, 21 days ahead,
 * and at most 8 confirmed bookings per Denver day. Every value can be
 * overridden with a BOOKING_* env var. There is no admin UI yet.
 *
 * TODO(calendar): subtract Google Calendar busy times (plus the buffer)
 * before offering a slot. This grid only knows about PickupRoster bookings.
 */

export type BookingKind = "demo" | "intro";

export type BookingRules = {
  timeZone: string;
  /** ISO weekdays, Monday = 1 … Sunday = 7. */
  weekdays: number[];
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMs: number;
  horizonMs: number;
  maxPerDay: number;
};

export type Slot = {
  start: Date;
  end: Date;
  /** YYYY-MM-DD in the schedule timezone. */
  dayKey: string;
};

const DEFAULTS: BookingRules = {
  timeZone: "America/Denver",
  weekdays: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  endMinutes: 16 * 60,
  slotMinutes: 30,
  bufferMinutes: 15,
  minNoticeMs: 12 * 60 * 60 * 1000,
  horizonMs: 21 * 24 * 60 * 60 * 1000,
  maxPerDay: 8,
};

function readEnv(context: any, key: string): string | undefined {
  const raw = context?.cloudflare?.env?.[key] ?? process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(raw: string | undefined, fallback = "America/Denver"): string {
  if (raw && isValidTimeZone(raw)) return raw;
  return fallback;
}

export function bookingRulesFromContext(context: any): BookingRules {
  const timeZone = safeTimeZone(readEnv(context, "BOOKING_TIMEZONE"), DEFAULTS.timeZone);
  const startHour = intIn(readEnv(context, "BOOKING_START_HOUR"), 9, 0, 23);
  const endHour = intIn(readEnv(context, "BOOKING_END_HOUR"), 16, 1, 24);
  const weekdays = parseWeekdays(readEnv(context, "BOOKING_WEEKDAYS")) ?? DEFAULTS.weekdays;
  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60;
  return {
    timeZone,
    weekdays,
    startMinutes: endMinutes > startMinutes ? startMinutes : DEFAULTS.startMinutes,
    endMinutes: endMinutes > startMinutes ? endMinutes : DEFAULTS.endMinutes,
    slotMinutes: intIn(readEnv(context, "BOOKING_SLOT_MINUTES"), DEFAULTS.slotMinutes, 5, 180),
    bufferMinutes: intIn(readEnv(context, "BOOKING_BUFFER_MINUTES"), DEFAULTS.bufferMinutes, 0, 180),
    minNoticeMs:
      intIn(readEnv(context, "BOOKING_MIN_NOTICE_HOURS"), 12, 0, 24 * 14) * 60 * 60 * 1000,
    horizonMs:
      intIn(readEnv(context, "BOOKING_HORIZON_DAYS"), 21, 1, 90) * 24 * 60 * 60 * 1000,
    maxPerDay: intIn(readEnv(context, "BOOKING_MAX_PER_DAY"), DEFAULTS.maxPerDay, 0, 100),
  };
}

function parseWeekdays(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const days = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return days.length > 0 ? [...new Set(days)] : null;
}

export type ZonedParts = {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    weekday: WEEKDAY_INDEX[bag.weekday] ?? 0,
  };
}

/** Minutes to add to UTC to get the wall clock in `timeZone`. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hour, parts.minute, 0);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function zonedDateTimeToUtc(
  parts: { y: number; m: number; d: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hour, parts.minute, 0);
  const first = offsetMinutes(new Date(guess), timeZone);
  let utc = guess - first * 60_000;
  const second = offsetMinutes(new Date(utc), timeZone);
  if (second !== first) utc = guess - second * 60_000;
  return new Date(utc);
}

export function dayKeyFromParts(parts: { y: number; m: number; d: number }): string {
  const m = String(parts.m).padStart(2, "0");
  const d = String(parts.d).padStart(2, "0");
  return `${parts.y}-${m}-${d}`;
}

export function addCalendarDays(
  parts: { y: number; m: number; d: number },
  days: number,
): { y: number; m: number; d: number } {
  const next = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return {
    y: next.getUTCFullYear(),
    m: next.getUTCMonth() + 1,
    d: next.getUTCDate(),
  };
}

export function dayWindow(dayKey: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = dayKey.split("-").map(Number);
  const start = zonedDateTimeToUtc({ y, m, d, hour: 0, minute: 0 }, timeZone);
  const next = addCalendarDays({ y, m, d }, 1);
  const end = zonedDateTimeToUtc({ ...next, hour: 0, minute: 0 }, timeZone);
  return { start, end };
}

/** One host, so a start time is unique across demos and intro calls. */
export function slotKey(start: Date): string {
  return start.toISOString();
}

/**
 * Open slots. Pass `taken` (start ISO strings) and `countsByDay` (Denver
 * day key → confirmed count) to hide booked and full days. Omit both when
 * checking whether an instant is on the grid at all.
 */
export function generateSlots(args: {
  now: Date;
  rules: BookingRules;
  taken?: ReadonlySet<string>;
  countsByDay?: ReadonlyMap<string, number>;
}): Slot[] {
  const { now, rules } = args;
  const taken = args.taken;
  const counts = args.countsByDay;
  const earliest = now.getTime() + rules.minNoticeMs;
  const latest = now.getTime() + rules.horizonMs;
  const today = zonedParts(now, rules.timeZone);
  const horizonDays = Math.ceil(rules.horizonMs / (24 * 60 * 60 * 1000)) + 1;
  const step = rules.slotMinutes + rules.bufferMinutes;
  const slots: Slot[] = [];

  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = addCalendarDays(today, offset);
    const noon = zonedDateTimeToUtc({ ...day, hour: 12, minute: 0 }, rules.timeZone);
    const weekday = zonedParts(noon, rules.timeZone).weekday;
    if (!rules.weekdays.includes(weekday)) continue;
    const key = dayKeyFromParts(day);
    if (counts && (counts.get(key) ?? 0) >= rules.maxPerDay) continue;

    for (let minute = rules.startMinutes; minute + rules.slotMinutes <= rules.endMinutes; minute += step) {
      const start = zonedDateTimeToUtc(
        { ...day, hour: Math.floor(minute / 60), minute: minute % 60 },
        rules.timeZone,
      );
      const startMs = start.getTime();
      if (startMs < earliest || startMs > latest) continue;
      if (taken?.has(start.toISOString())) continue;
      const end = new Date(startMs + rules.slotMinutes * 60_000);
      slots.push({ start, end, dayKey: key });
    }
  }
  return slots;
}

export type SlotLabel = {
  day: string;
  time: string;
  zone: string;
};

export function formatSlotRange(
  start: Date,
  end: Date,
  timeZone: string,
  locale: string,
): SlotLabel {
  const zone = safeTimeZone(timeZone);
  const dayFmt = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
  const zoneFmt = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: "short",
  });
  const zoneName =
    zoneFmt.formatToParts(start).find((part) => part.type === "timeZoneName")?.value ?? zone;
  return {
    day: dayFmt.format(start),
    time: `${timeFmt.format(start)}–${timeFmt.format(end)}`,
    zone: zoneName,
  };
}
