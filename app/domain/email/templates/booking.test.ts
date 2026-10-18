import test from "node:test";
import assert from "node:assert/strict";
import { renderBookingMail } from "./booking";
import type { BookingMailMessage } from "../types";

const message: BookingMailMessage = {
  kind: "booking_mail",
  to: "ada@school.edu",
  audience: "booker",
  event: "confirmed",
  bookingKind: "demo",
  bookingId: "book_1",
  sequence: 0,
  name: "Ada Lovelace",
  email: "ada@school.edu",
  role: "Principal",
  school: "Maple Elementary",
  phone: null,
  studentCount: "400",
  message: "We use radios.",
  startsAt: "2027-01-05T16:00:00.000Z",
  endsAt: "2027-01-05T16:30:00.000Z",
  visitorTimeZone: "America/New_York",
  scheduleTimeZone: "America/Denver",
  manageUrl: "https://pickuproster.com/book/manage?token=abc",
  meetingUrl: null,
  hostEmail: "NoahSundberg@gmail.com",
  locale: "en",
};

test("the booker confirmation attaches an invite and replies to Noah", async () => {
  const rendered = await renderBookingMail(message);
  assert.match(rendered.subject, /demo is booked/i);
  assert.match(rendered.text, /Noah will send a meeting link/);
  assert.match(rendered.text, /Maple Elementary|11:00/);
  assert.match(rendered.text, /book\/manage\?token=abc/);
  assert.equal(rendered.replyTo, "NoahSundberg@gmail.com");
  assert.equal(rendered.ics?.method, "REQUEST");
  const ics = (rendered.ics?.content ?? "").replace(/\r\n[ \t]/g, "");
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /ORGANIZER;CN=Noah at PickupRoster:mailto:noah@pickuproster.com/);
  assert.match(ics, /mailto:ada@school.edu/);
  assert.match(ics, /mailto:NoahSundberg@gmail.com/);
  assert.match(ics, /UID:booking-book_1@pickuproster.com/);
});

test("the host copy includes the school details and the meeting link", async () => {
  const rendered = await renderBookingMail({
    ...message,
    to: "NoahSundberg@gmail.com",
    audience: "host",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.match(rendered.text, /Maple Elementary/);
  assert.match(rendered.text, /ada@school.edu/);
  assert.match(rendered.text, /400/);
  assert.match(rendered.text, /We use radios/);
  assert.match(rendered.text, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.equal(rendered.replyTo, "ada@school.edu");
  assert.match(
    (rendered.ics?.content ?? "").replace(/\r\n[ \t]/g, ""),
    /LOCATION:https:\/\/meet\.google\.com\/abc-defg-hij/,
  );
});

test("a cancellation uses METHOD:CANCEL", async () => {
  const rendered = await renderBookingMail({
    ...message,
    event: "cancelled",
    sequence: 2,
  });
  assert.equal(rendered.ics?.method, "CANCEL");
  assert.match(rendered.ics?.content ?? "", /METHOD:CANCEL/);
  assert.match(rendered.ics?.content ?? "", /STATUS:CANCELLED/);
  assert.match(rendered.ics?.content ?? "", /SEQUENCE:2/);
});
