import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingRulesFromContext,
  formatSlotRange,
  generateSlots,
  zonedDateTimeToUtc,
} from "./rules";

const rules = bookingRulesFromContext({});

test("Denver wall time converts across daylight saving", () => {
  assert.equal(
    zonedDateTimeToUtc({ y: 2026, m: 7, d: 6, hour: 9, minute: 0 }, "America/Denver").toISOString(),
    "2026-07-06T15:00:00.000Z",
  );
  assert.equal(
    zonedDateTimeToUtc({ y: 2027, m: 1, d: 5, hour: 9, minute: 0 }, "America/Denver").toISOString(),
    "2027-01-05T16:00:00.000Z",
  );
});

test("slots are weekdays, 30 minutes, with a 15-minute buffer, inside the notice window", () => {
  const now = new Date("2027-01-04T15:00:00.000Z");
  const slots = generateSlots({ now, rules });
  assert.equal(slots[0]?.start.toISOString(), "2027-01-05T16:00:00.000Z");
  assert.equal(slots[0]?.end.toISOString(), "2027-01-05T16:30:00.000Z");
  assert.equal(slots[1]?.start.toISOString(), "2027-01-05T16:45:00.000Z");
  const saturday = slots.filter((slot) => slot.dayKey === "2027-01-09");
  const sunday = slots.filter((slot) => slot.dayKey === "2027-01-10");
  assert.equal(saturday.length, 0);
  assert.equal(sunday.length, 0);
  const tooSoon = slots.find((slot) => slot.start.getTime() < now.getTime() + 12 * 60 * 60 * 1000);
  assert.equal(tooSoon, undefined);
  const tooLate = slots.find((slot) => slot.start.getTime() > now.getTime() + 21 * 24 * 60 * 60 * 1000);
  assert.equal(tooLate, undefined);
});

test("a taken start and a full day are hidden, and the visitor zone is labeled", () => {
  const now = new Date("2027-01-04T15:00:00.000Z");
  const open = generateSlots({ now, rules });
  const first = open[0]!;
  const withoutTaken = generateSlots({
    now,
    rules,
    taken: new Set([first.start.toISOString()]),
  });
  assert.equal(
    withoutTaken.some((slot) => slot.start.toISOString() === first.start.toISOString()),
    false,
  );
  const capped = generateSlots({
    now,
    rules,
    countsByDay: new Map([[first.dayKey, rules.maxPerDay]]),
  });
  assert.equal(
    capped.some((slot) => slot.dayKey === first.dayKey),
    false,
  );

  const label = formatSlotRange(
    new Date("2027-01-05T16:00:00.000Z"),
    new Date("2027-01-05T16:30:00.000Z"),
    "America/New_York",
    "en-US",
  );
  assert.match(label.time, /11:00/);
  assert.match(label.zone, /EST/);
  assert.match(label.day, /January 5/);
});

test("booking rules read env overrides and ignore a bad timezone", () => {
  const custom = bookingRulesFromContext({
    cloudflare: {
      env: {
        BOOKING_TIMEZONE: "Not/AZone",
        BOOKING_MAX_PER_DAY: "3",
        BOOKING_SLOT_MINUTES: "20",
      },
    },
  });
  assert.equal(custom.timeZone, "America/Denver");
  assert.equal(custom.maxPerDay, 3);
  assert.equal(custom.slotMinutes, 20);
});
