/**
 * Shared email types.
 *
 * EmailMessage is the discriminated union consumed by the EMAIL_QUEUE handler.
 * Keep this extensible — add a new `kind` + shape and a matching template in
 * ./templates/index.ts, and the queue consumer picks it up automatically.
 */

export type WelcomeMessage = {
  kind: "welcome";
  to: string;
  orgName: string;
  orgSlug: string;
  /** Optional greeting name — null is fine, template handles it. */
  userName: string | null;
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
};

/**
 * Queue-heartbeat probe. Enqueued by the 2-minute status cron; dropped by the
 * consumer before reaching Resend. No template or email send is associated.
 */
export type ProbeMessage = {
  kind: "probe";
};

/**
 * Messages that actually result in an outbound Resend email. The probe kind
 * is excluded because it has no recipient/template.
 */
export type SendableEmailMessage =
  | WelcomeMessage
  | TrialExpiringMessage
  | MidTrialCheckinMessage
  | PasswordResetMessage;

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
};

/** From address used for all outbound mail. Founder voice for now. */
export const DEFAULT_FROM = "Noah at Pickup Roster <noah@pickuproster.com>";
