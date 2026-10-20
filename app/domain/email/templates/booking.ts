import type { BookingMailMessage, RenderedEmail } from "../types";
import { getFixedT } from "~/lib/t.server";
import { escapeAttr, escapeHtml } from "../html";
import { buildBookingIcs } from "~/domain/booking/ics";
import { formatSlotRange } from "~/domain/booking/rules";
import { zoomJoinDetails } from "~/lib/site";
import type { TFunction } from "i18next";

function meetingCopy(
  t: TFunction,
  meetingUrl: string,
): { text: string; html: string } {
  const details = zoomJoinDetails(meetingUrl);
  const lines = [
    t("booking.meetingSet", { url: meetingUrl }),
    details ? t("booking.meetingId", { id: details.id }) : "",
    details ? t("booking.meetingPasscode", { passcode: details.passcode }) : "",
  ].filter(Boolean);
  const htmlLines = [
    `${escapeHtml(t("booking.meetingLabel"))}: <a href="${escapeAttr(meetingUrl)}">${escapeHtml(meetingUrl)}</a>`,
    details ? escapeHtml(t("booking.meetingId", { id: details.id })) : "",
    details ? escapeHtml(t("booking.meetingPasscode", { passcode: details.passcode })) : "",
  ].filter(Boolean);
  return { text: lines.join("\n"), html: htmlLines.join("<br>") };
}

function whenLabel(msg: BookingMailMessage, timeZone: string, locale: string): string {
  const start = new Date(msg.startsAt);
  const end = new Date(msg.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return msg.startsAt;
  const label = formatSlotRange(start, end, timeZone, locale);
  return `${label.day}, ${label.time} ${label.zone}`;
}

/**
 * Booker confirmation and the founder's copy. Both attach the same .ics.
 * The booker's reply-to is the signup inbox. The founder's reply-to is the booker.
 */
export async function renderBookingMail(msg: BookingMailMessage): Promise<RenderedEmail> {
  const locale = msg.audience === "host" ? "en" : (msg.locale ?? "en");
  const t = await getFixedT(locale, "email");
  const visitorWhen = whenLabel(msg, msg.visitorTimeZone, locale);
  const hostWhen = whenLabel(msg, msg.scheduleTimeZone, "en");
  const meetingUrl = msg.meetingUrl?.trim() ?? "";
  const copied = meetingUrl ? meetingCopy(t, meetingUrl) : null;
  const meeting = copied?.text ?? t("booking.meetingLater");
  const meetingHtml = copied?.html ?? escapeHtml(meeting);
  const kindLabel = msg.bookingKind === "intro" ? t("booking.introName") : t("booking.demoName");

  const subject =
    msg.event === "cancelled"
      ? t("booking.cancelledSubject", { kind: kindLabel })
      : msg.event === "rescheduled"
        ? t("booking.rescheduledSubject", { kind: kindLabel })
        : msg.bookingKind === "intro"
          ? t("booking.introSubject")
          : t("booking.demoSubject");

  const lead =
    msg.event === "cancelled"
      ? t("booking.cancelledBody")
      : msg.event === "rescheduled"
        ? t("booking.rescheduledBody")
        : msg.bookingKind === "intro"
          ? t("booking.introBody")
          : t("booking.demoBody");

  const detailLines = [
    t("booking.when", { when: msg.audience === "host" ? `${hostWhen} (${visitorWhen})` : visitorWhen }),
    meeting,
    t("booking.manage", { url: msg.manageUrl }),
  ];
  if (msg.audience === "host") {
    detailLines.push(
      t("booking.name", { name: msg.name }),
      t("booking.email", { email: msg.email }),
      t("booking.role", { role: msg.role?.trim() || t("booking.notProvided") }),
      t("booking.school", { school: msg.school?.trim() || t("booking.notProvided") }),
      t("booking.phone", { phone: msg.phone?.trim() || t("booking.notProvided") }),
      t("booking.studentCount", { studentCount: msg.studentCount?.trim() || t("booking.notProvided") }),
      t("booking.message", { message: msg.message?.trim() || t("booking.notProvided") }),
    );
  }

  const greeting = t("booking.greeting", { name: msg.name });
  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(lead)}</p>
    <ul>
      <li>${escapeHtml(detailLines[0] ?? "")}</li>
      <li>${meetingHtml}</li>
      ${detailLines
        .slice(2)
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("\n      ")}
    </ul>
    <p><a href="${escapeAttr(msg.manageUrl)}">${escapeHtml(t("booking.manageLink"))}</a></p>
  </body>
</html>`;
  const text = `${greeting}\n\n${lead}\n\n${detailLines.join("\n")}\n\n${msg.manageUrl}`;

  const summary =
    msg.event === "cancelled"
      ? `Cancelled: ${kindLabel}`
      : `${kindLabel} — ${msg.school?.trim() || msg.name}`;
  const description = [lead, meeting, `Cancel or reschedule: ${msg.manageUrl}`].join("\n");
  const ics = buildBookingIcs({
    method: msg.event === "cancelled" ? "CANCEL" : "REQUEST",
    bookingId: msg.bookingId,
    sequence: msg.sequence,
    kind: msg.bookingKind,
    start: new Date(msg.startsAt),
    end: new Date(msg.endsAt),
    bookerName: msg.name,
    bookerEmail: msg.email,
    hostEmail: msg.hostEmail,
    summary,
    description,
    meetingUrl: msg.meetingUrl,
  });

  return {
    subject,
    html,
    text,
    replyTo: msg.audience === "host" ? msg.email : msg.hostEmail,
    ics,
  };
}
