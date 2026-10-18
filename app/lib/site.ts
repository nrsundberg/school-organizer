/** Product name on marketing routes and when no org is in context. */
export const DEFAULT_SITE_NAME = "PickupRoster";

/** Fallback support email when `SUPPORT_EMAIL` env is not set. */
export const DEFAULT_SUPPORT_EMAIL = "support@pickuproster.com";

/**
 * Inbox that receives a notification when a school or district starts a trial.
 * Override with the `SIGNUP_NOTIFY_EMAIL` Worker secret if this should go
 * somewhere else. Sending never blocks signup.
 */
export const DEFAULT_SIGNUP_NOTIFY_EMAIL = "NoahSundberg@gmail.com";

function readEnv(context: any, key: string): string | undefined {
  const raw = context?.cloudflare?.env?.[key] ?? process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the support email from the request context.
 *
 * Reads `context.cloudflare.env.SUPPORT_EMAIL`, then falls back to
 * `process.env.SUPPORT_EMAIL`, then to `DEFAULT_SUPPORT_EMAIL`.
 */
export function getSupportEmail(context: any): string {
  return readEnv(context, "SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
}

export function getSignupNotifyEmail(context: any): string {
  const configured = readEnv(context, "SIGNUP_NOTIFY_EMAIL");
  if (configured && configured.includes("@")) return configured;
  return DEFAULT_SIGNUP_NOTIFY_EMAIL;
}

function httpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function bookingOrigin(context: any): string {
  const raw = context?.cloudflare?.env?.PUBLIC_ROOT_DOMAIN;
  const root = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (root && root !== "localhost" && !root.endsWith(".localhost")) {
    return `https://${root}`;
  }
  return "https://pickuproster.com";
}

/**
 * Public page for the two free intro calls.
 *
 * `INTRO_CALL_BOOKING_URL` overrides the built-in scheduler. When it is
 * unset or not an http(s) URL, the link is the in-app page `/book/intro`.
 */
export function getIntroCallBookingUrl(context: any): string {
  return (
    httpUrl(readEnv(context, "INTRO_CALL_BOOKING_URL")) ??
    `${bookingOrigin(context)}/book/intro`
  );
}

/**
 * Public page for a demo.
 *
 * `DEMO_BOOKING_URL` overrides the built-in scheduler. When it is unset or
 * not an http(s) URL, the link is the in-app page `/demo`.
 */
export function getDemoBookingUrl(context: any): string {
  return (
    httpUrl(readEnv(context, "DEMO_BOOKING_URL")) ??
    `${bookingOrigin(context)}/demo`
  );
}

/**
 * Shared meeting room included in the calendar invite.
 * Leave unset until a room exists — the email then says Noah will send a link.
 */
export function getMeetingUrl(context: any): string | null {
  return httpUrl(readEnv(context, "MEETING_URL"));
}
