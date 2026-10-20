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

/**
 * Inbox for new support tickets from the help chat and contact form.
 * Override with the `SUPPORT_NOTIFY_EMAIL` Worker var or secret.
 */
export const DEFAULT_SUPPORT_NOTIFY_EMAIL = "NoahSundberg@gmail.com";

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

export function getSupportNotifyEmail(context: any): string {
  const configured = readEnv(context, "SUPPORT_NOTIFY_EMAIL");
  if (configured && configured.includes("@")) return configured;
  return DEFAULT_SUPPORT_NOTIFY_EMAIL;
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
 * Zoom room included in the calendar invite.
 * `ZOOM_MEETING_URL` wins. `MEETING_URL` is the fallback.
 * When both are unset, the email says Noah will send a Zoom link.
 */
export function getMeetingUrl(context: any): string | null {
  return (
    httpUrl(readEnv(context, "ZOOM_MEETING_URL")) ??
    httpUrl(readEnv(context, "MEETING_URL"))
  );
}

/** Noah's Zoom Personal Room. The join URL embeds the passcode; mail also prints these. */
const ZOOM_PERSONAL_ROOM = {
  digits: "3504620740",
  id: "350 462 0740",
  passcode: "Zd8X3j",
};

export function zoomJoinDetails(
  url: string | null | undefined,
): { id: string; passcode: string } | null {
  if (!url || !url.includes(`/j/${ZOOM_PERSONAL_ROOM.digits}`)) return null;
  return { id: ZOOM_PERSONAL_ROOM.id, passcode: ZOOM_PERSONAL_ROOM.passcode };
}
