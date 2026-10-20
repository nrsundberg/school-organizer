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
  assert.match(rendered.text, /Noah will send a Zoom link/);
  assert.doesNotMatch(rendered.ics?.content ?? "", /LOCATION:/);
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

test("the host copy includes the school details and the Zoom link", async () => {
  const rendered = await renderBookingMail({
    ...message,
    to: "NoahSundberg@gmail.com",
    audience: "host",
    meetingUrl: "https://zoom.us/j/123456789",
  });
  assert.match(rendered.text, /Maple Elementary/);
  assert.match(rendered.text, /ada@school.edu/);
  assert.match(rendered.text, /400/);
  assert.match(rendered.text, /We use radios/);
  assert.match(rendered.text, /Join Zoom meeting: https:\/\/zoom\.us\/j\/123456789/);
  assert.match(rendered.html, /Join Zoom meeting/);
  assert.match(rendered.html, /href="https:\/\/zoom\.us\/j\/123456789"/);
  assert.equal(rendered.replyTo, "ada@school.edu");
  const ics = (rendered.ics?.content ?? "").replace(/\r\n[ \t]/g, "");
  assert.match(ics, /LOCATION:https:\/\/zoom\.us\/j\/123456789/);
  assert.match(ics, /Join Zoom meeting: https:\/\/zoom\.us\/j\/123456789/);
});

const PERSONAL_ROOM =
  "https://us05web.zoom.us/j/3504620740?pwd=kFLGxaFkDuO8z0q4KLXIBlLzfsYQib.1";

test("the personal room prints the join link, meeting ID, and passcode", async () => {
  const booker = await renderBookingMail({ ...message, meetingUrl: PERSONAL_ROOM });
  const host = await renderBookingMail({
    ...message,
    to: "NoahSundberg@gmail.com",
    audience: "host",
    meetingUrl: PERSONAL_ROOM,
  });
  for (const rendered of [booker, host]) {
    assert.match(rendered.text, /Join Zoom meeting: https:\/\/us05web\.zoom\.us\/j\/3504620740/);
    assert.match(rendered.text, /Meeting ID: 350 462 0740/);
    assert.match(rendered.text, /Passcode: Zd8X3j/);
    assert.doesNotMatch(rendered.text, /will send a Zoom link/);
    assert.match(rendered.html, /Join Zoom meeting/);
    assert.match(rendered.html, /350 462 0740/);
    assert.match(rendered.html, /Zd8X3j/);
    const ics = (rendered.ics?.content ?? "").replace(/\r\n[ \t]/g, "");
    assert.match(ics, /LOCATION:https:\/\/us05web\.zoom\.us\/j\/3504620740/);
    assert.match(ics, /URL:https:\/\/us05web\.zoom\.us\/j\/3504620740/);
    assert.match(ics, /Meeting ID: 350 462 0740/);
    assert.match(ics, /Passcode: Zd8X3j/);
    assert.doesNotMatch(ics, /will send a Zoom link/);
  }
  assert.equal(booker.replyTo, "NoahSundberg@gmail.com");
  assert.equal(host.replyTo, "ada@school.edu");
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
