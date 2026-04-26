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
  | PasswordResetMessage
  | UserInviteMessage;

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
