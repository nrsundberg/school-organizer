/**
 * iCalendar invite attached to booking mail.
 * METHOD:REQUEST creates or updates the event. METHOD:CANCEL removes it.
 * The UID stays on the booking id so a reschedule updates the same event.
 */

const ORGANIZER_EMAIL = "noah@pickuproster.com";

export type IcsInvite = {
  method: "REQUEST" | "CANCEL";
  filename: string;
  content: string;
};

function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function buildBookingIcs(args: {
  method: "REQUEST" | "CANCEL";
  bookingId: string;
  sequence: number;
  kind: "demo" | "intro";
  start: Date;
  end: Date;
  bookerName: string;
  bookerEmail: string;
  hostEmail: string;
  summary: string;
  description: string;
  meetingUrl: string | null;
}): IcsInvite {
  const uid = `booking-${args.bookingId}@pickuproster.com`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PickupRoster//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${args.method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(args.start)}`,
    `DTEND:${icsUtc(args.end)}`,
    `SEQUENCE:${args.sequence}`,
    `SUMMARY:${icsText(args.summary)}`,
    `DESCRIPTION:${icsText(args.description)}`,
    `ORGANIZER;CN=Noah at PickupRoster:mailto:${ORGANIZER_EMAIL}`,
    `ATTENDEE;CN=${icsText(args.bookerName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${args.bookerEmail}`,
    `ATTENDEE;CN=Noah Sundberg;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${args.hostEmail}`,
    args.method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
  ];
  if (args.meetingUrl) {
    lines.push(`LOCATION:${icsText(args.meetingUrl)}`);
    lines.push(`URL:${args.meetingUrl}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return {
    method: args.method,
    filename: args.method === "CANCEL" ? "pickuproster-cancel.ics" : `pickuproster-${args.kind}.ics`,
    content: `${lines.map(fold).join("\r\n")}\r\n`,
  };
}
