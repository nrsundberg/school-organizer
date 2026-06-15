export const DISMISSAL_PLANS = [
  "Car line",
  "Walker",
  "Bus",
  "After-school program",
  "Office pickup",
  "Other",
] as const;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type ScheduleKind = "DATE" | "WEEKLY";

export type DateRange = {
  from: Date;
  to: Date;
};

export function parseDateOnly(raw: string | null | undefined, fieldName = "date"): Date {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${fieldName} is required.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${fieldName} must use YYYY-MM-DD.`);
  }

  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid.`);
  }
  return date;
}

export function parseOptionalDateOnly(raw: string | null | undefined, fieldName = "date"): Date | null {
  const value = raw?.trim();
  return value ? parseDateOnly(value, fieldName) : null;
}

/** UTC end-of-day (23:59:59.999) of `date`'s calendar day. */
export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

/** UTC midnight at the start of `date`'s calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Minimal shape of a dismissal-exception row needed to test "active today". */
export type ExceptionActivityWindow = {
  scheduleKind: string;
  exceptionDate: Date | null;
  dayOfWeek: number | null;
  startsOn: Date | null;
  endsOn: Date | null;
};

/**
 * Returns true if `exception` is "active" on the given `today` (compared in
 * UTC day terms): either a DATE row whose `exceptionDate` is the same UTC day,
 * or a WEEKLY row whose `dayOfWeek` matches and whose optional `startsOn`/
 * `endsOn` window contains the day. Shared by the households index and the
 * admin dashboard so their "exceptions today" views always agree.
 */
export function exceptionActiveOn(
  exception: ExceptionActivityWindow,
  today: Date,
): boolean {
  const dayStart = startOfUtcDay(today);
  if (exception.scheduleKind === "DATE") {
    if (!exception.exceptionDate) return false;
    return startOfUtcDay(exception.exceptionDate).getTime() === dayStart.getTime();
  }
  if (exception.dayOfWeek == null) return false;
  if (today.getUTCDay() !== exception.dayOfWeek) return false;
  if (exception.startsOn && dayStart.getTime() < startOfUtcDay(exception.startsOn).getTime()) {
    return false;
  }
  if (exception.endsOn && dayStart.getTime() > startOfUtcDay(exception.endsOn).getTime()) {
    return false;
  }
  return true;
}

export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateRangeFromSearchParams(url: URL, daysBack = 30, now = new Date()): DateRange & { fromInput: string; toInput: string } {
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - daysBack);

  let from = defaultFrom;
  let to = defaultTo;
  try {
    from = parseOptionalDateOnly(url.searchParams.get("from"), "From date") ?? defaultFrom;
  } catch {
    from = defaultFrom;
  }
  try {
    to = parseOptionalDateOnly(url.searchParams.get("to"), "To date") ?? defaultTo;
  } catch {
    to = defaultTo;
  }

  if (from.getTime() > to.getTime()) {
    return {
      from: to,
      to: endOfUtcDay(from),
      fromInput: toDateInputValue(to),
      toInput: toDateInputValue(from),
    };
  }

  return {
    from,
    to: endOfUtcDay(to),
    fromInput: toDateInputValue(from),
    toInput: toDateInputValue(to),
  };
}

export function countWeekdayOccurrences(dayOfWeek: number, range: DateRange): number {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return 0;

  const start = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()));
  const end = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()));
  if (start.getTime() > end.getTime()) return 0;

  const offset = (dayOfWeek - start.getUTCDay() + 7) % 7;
  const first = new Date(start);
  first.setUTCDate(first.getUTCDate() + offset);
  if (first.getTime() > end.getTime()) return 0;

  const diffDays = Math.floor((end.getTime() - first.getTime()) / 86_400_000);
  return Math.floor(diffDays / 7) + 1;
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.from.getTime() <= b.to.getTime() && b.from.getTime() <= a.to.getTime();
}
