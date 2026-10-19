import { enqueueEmail } from "~/domain/email/queue.server";
import { getSignupNotifyEmail } from "~/lib/site";
import type { BookingRecord } from "./store";

/**
 * Confirmation to the booker and a copy to the signup inbox (Noah, unless
 * SIGNUP_NOTIFY_EMAIL is set). Both carry the same calendar invite.
 * Failures are logged and swallowed so the visitor still sees confirmation.
 */
export async function notifyBooking(args: {
  context: any;
  booking: BookingRecord;
  event: "confirmed" | "cancelled" | "rescheduled";
  scheduleTimeZone: string;
  manageUrl: string;
  meetingUrl: string | null;
  locale?: string;
}): Promise<void> {
  const hostEmail = getSignupNotifyEmail(args.context);
  const shared = {
    bookingKind: args.booking.kind === "intro" ? "intro" as const : "demo" as const,
    bookingId: args.booking.id,
    sequence: args.booking.sequence,
    name: args.booking.name,
    email: args.booking.email,
    role: args.booking.role,
    school: args.booking.school,
    phone: args.booking.phone,
    studentCount: args.booking.studentCount,
    message: args.booking.message,
    startsAt: args.booking.startsAt.toISOString(),
    endsAt: args.booking.endsAt.toISOString(),
    visitorTimeZone: args.booking.visitorTimeZone,
    scheduleTimeZone: args.scheduleTimeZone,
    manageUrl: args.manageUrl,
    meetingUrl: args.meetingUrl,
    hostEmail,
    event: args.event,
  };
  try {
    await enqueueEmail(args.context, {
      kind: "booking_mail",
      to: args.booking.email,
      audience: "booker",
      locale: args.locale ?? "en",
      ...shared,
    });
    await enqueueEmail(args.context, {
      kind: "booking_mail",
      to: hostEmail,
      audience: "host",
      locale: "en",
      ...shared,
    });
  } catch (err) {
    console.error("notifyBooking failed", err);
  }
}
