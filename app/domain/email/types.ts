/**
 * Shared email types.
 *
 * EmailMessage is the discriminated union consumed by the EMAIL_QUEUE handler.
 * Keep this extensible — add a new `kind` + shape and a matching template in
 * ./templates/index.ts, and the queue consumer picks it up automatically.
 */

/**
 * Recipient locale plumbed end-to-end into every sendable email so the queue
 * consumer can render copy in the right language. Optional on the wire so
 * legacy enqueues (and tests) don't have to change at once — templates fall
 * back to `DEFAULT_LANGUAGE` when omitted. See `docs/i18n-contract.md`
 * ("Server-side `t` usage").
 */
export type EmailLocale = string;

export type WelcomeMessage = {
  kind: "welcome";
  to: string;
  orgName: string;
  orgSlug: string;
  /** Optional greeting name — null is fine, template handles it. */
  userName: string | null;
  /** Recipient locale (BCP-47 short, e.g. "en", "es"). Optional; defaults to "en". */
  locale?: EmailLocale;
  /**
   * Public booking page for the two free intro calls. Null/omitted when
   * `INTRO_CALL_BOOKING_URL` is unset — the template then asks them to reply.
   */
  introCallBookingUrl?: string | null;
};

/**
 * Internal notice to the founder when a school or district starts a trial.
 * Always English. Failures must not block signup.
 */
export type SignupNotificationMessage = {
  kind: "signup_notification";
  to: string;
  schoolName: string;
  personName: string | null;
  personEmail: string;
  /** Billing plan stored at signup, e.g. CAR_LINE, CAMPUS, DISTRICT. */
  plan: string;
  /** ISO-8601 timestamp of the signup. */
  signedUpAt: string;
  locale?: EmailLocale;
};

/**
 * Calendar mail for a demo or intro call. Sent twice: once to the booker
 * and once to the signup inbox. Both messages carry the same .ics payload.
 */
export type BookingMailMessage = {
  kind: "booking_mail";
  to: string;
  audience: "booker" | "host";
  event: "confirmed" | "cancelled" | "rescheduled";
  bookingKind: "demo" | "intro";
  bookingId: string;
  sequence: number;
  name: string;
  email: string;
  role: string | null;
  school: string | null;
  phone: string | null;
  studentCount: string | null;
  message: string | null;
  startsAt: string;
  endsAt: string;
  visitorTimeZone: string;
  scheduleTimeZone: string;
  manageUrl: string;
  meetingUrl: string | null;
  hostEmail: string;
  locale?: EmailLocale;
};

/**
 * Internal notice when someone submits the public demo form.
 * Always English. Failures must not surface as a 500 to the visitor.
 */
export type DemoRequestMessage = {
  kind: "demo_request";
  to: string;
  name: string;
  role: string;
  school: string;
  email: string;
  phone: string | null;
  studentCount: string | null;
  message: string | null;
  submittedAt: string;
  locale?: EmailLocale;
};

export type TrialExpiringMessage = {
  kind: "trial_expiring";
  to: string;
  orgName: string;
  orgSlug: string;
  /** 7, 3, or 1 — matches the scheduled trigger. */
  daysLeft: number;
  /** Pre-formatted trial end date (e.g. "April 28") for copy interpolation. */
  trialEndDate: string;
  /** Optional greeting name. */
  userName: string | null;
  /** Recipient locale. Optional; defaults to "en". */
  locale?: EmailLocale;
};

export type MidTrialCheckinMessage = {
  kind: "mid_trial_checkin";
  to: string;
  orgName: string;
  orgSlug: string;
  /** ~14 at send time; included so the copy can reference it. */
  daysIn: number;
  /** Optional greeting name. */
  userName: string | null;
  /** Recipient locale. Optional; defaults to "en". */
  locale?: EmailLocale;
};

export type PasswordResetMessage = {
  kind: "password_reset";
  to: string;
  /** Optional greeting name; template falls back to "there". */
  firstName: string | null;
  /** Fully-qualified URL to the reset form, including the raw token. */
  resetUrl: string;
  /** Minutes until the reset link expires — e.g. 60. */
  expiryMinutes: number;
  /** IP the request came from, surfaced in the "didn't request this?" footer. */
  requestIp?: string | null;
  /** Recipient locale. Optional; defaults to "en". */
  locale?: EmailLocale;
};

/**
 * "Staff created an account for you" invite. Single CTA: the magic link
 * that lets the recipient set their password and sign in for the first
 * time. No password is ever included.
 */
export type UserInviteMessage = {
  kind: "user_invite";
  to: string;
  /** Optional greeting name; template falls back to "there". */
  firstName: string | null;
  /** Fully-qualified URL to /accept-invite, including the raw token. */
  inviteUrl: string;
  /** Days until the invite link expires — e.g. 7. */
  expiryDays: number;
  /**
   * Friendly source label for the body copy. Pass the org/district name
   * for org/district invites, or null for platform-staff invites
   * (template falls back to a generic "Pickup Roster team" string).
   */
  invitedToLabel: string | null;
  /** Recipient locale. Optional; defaults to "en". */
  locale?: EmailLocale;
};

/**
 * Sent to every org admin (and the Pickup Roster ops address) when an admin
 * uses the dashboard "Danger Zone" to delete all student records. Purely
 * informational — it names who did it, how many records, and reassures that the
 * data is recoverable from backups for a limited window.
 */
export type StudentsDeletedMessage = {
  kind: "students_deleted";
  to: string;
  orgName: string;
  /** Who triggered the deletion (display name or email). */
  actorLabel: string;
  /** Number of student records removed. */
  deletedCount: number;
  /** Pre-formatted timestamp for the body copy. */
  deletedAt: string;
  /** True for the internal ops recipient (slightly different framing). */
  isOps?: boolean;
  /**
   * Which surface performed the deletion. Defaults to the dashboard Danger
   * Zone ("all student records"); `roster_import` swaps in copy for a partial
   * prune, where only students absent from the uploaded roster were removed.
   */
  source?: "danger_zone" | "roster_import";
  /** Recipient locale. Optional; defaults to "en". */
  locale?: EmailLocale;
};

/**
 * Queue-heartbeat probe. Enqueued by the 2-minute status cron; dropped by the
 * consumer before reaching Resend. No template or email send is associated.
 */
export type ProbeMessage = {
  kind: "probe";
};

/**
 * Internal notice when someone opens a support ticket from the help chat
 * or the contact form. English. Failures must not hide the saved ticket.
 */
export type SupportTicketNoticeMessage = {
  kind: "support_ticket_notice";
  to: string;
  ticketId: string;
  requesterName: string;
  requesterEmail: string;
  source: "chat" | "contact";
  subject: string;
  message: string;
  pagePath: string | null;
  inboxUrl: string;
};

/**
 * Staff reply mailed to the requester, with a link back to the thread.
 * Email replies from the requester are not ingested.
 */
export type SupportTicketReplyMessage = {
  kind: "support_ticket_reply";
  to: string;
  requesterName: string;
  subject: string;
  replyBody: string;
  threadUrl: string;
  /** Support inbox, so a mail-client reply still reaches a person. */
  replyTo: string;
};

/**
 * Messages that actually result in an outbound Resend email. The probe kind
 * is excluded because it has no recipient/template.
 */
export type SendableEmailMessage =
  | WelcomeMessage
  | TrialExpiringMessage
  | MidTrialCheckinMessage
  | PasswordResetMessage
  | UserInviteMessage
  | StudentsDeletedMessage
  | SignupNotificationMessage
  | DemoRequestMessage
  | BookingMailMessage
  | SupportTicketNoticeMessage
  | SupportTicketReplyMessage;

export type EmailMessage = SendableEmailMessage | ProbeMessage;

export type EmailKind = EmailMessage["kind"];

/** Every template function returns this shape. */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  /**
   * Optional Reply-To override. When set, the send wrapper passes it through
   * to Resend so replies land in a different inbox than the From address.
   * Omit (or leave undefined) to let Resend default to the From address.
   */
  replyTo?: string;
  /** Calendar invite attached by the Resend send. */
  ics?: {
    method: "REQUEST" | "CANCEL";
    filename: string;
    content: string;
  };
};

/** From address used for all outbound mail. Founder voice for now. */
export const DEFAULT_FROM = "Noah at PickupRoster <noah@pickuproster.com>";
