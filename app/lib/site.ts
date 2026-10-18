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

/**
 * Public booking link for the two free intro calls.
 *
 * Set `INTRO_CALL_BOOKING_URL` (an http or https URL) when a calendar exists.
 * Returns null when unset or invalid so the UI never invents a link.
 */
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

export function getIntroCallBookingUrl(context: any): string | null {
  return httpUrl(readEnv(context, "INTRO_CALL_BOOKING_URL"));
}

/**
 * Calendar link for the demo page.
 *
 * `DEMO_BOOKING_URL` wins. When it is unset, the intro-call calendar is used
 * so one booking link can cover both. Returns null when neither is a valid
 * http(s) URL.
 */
export function getDemoBookingUrl(context: any): string | null {
  return (
    httpUrl(readEnv(context, "DEMO_BOOKING_URL")) ??
    httpUrl(readEnv(context, "INTRO_CALL_BOOKING_URL"))
  );
}
