/**
 * Signed manage links for cancel and reschedule.
 *
 * The token is `base64url(json).base64url(hmac)`. It carries the booking id
 * and an expiry. The secret is BOOKING_TOKEN_SECRET, then BETTER_AUTH_SECRET.
 * In development, when neither is set, a fixed local secret is used so the
 * link still works. Production and staging refuse to sign without a real secret.
 */

const DEV_SECRET = "dev-booking-token";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 45;

function readEnv(context: any, key: string): string | undefined {
  const raw = context?.cloudflare?.env?.[key] ?? process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function bookingTokenSecret(context: any): string | null {
  const configured =
    readEnv(context, "BOOKING_TOKEN_SECRET") ?? readEnv(context, "BETTER_AUTH_SECRET");
  if (configured) return configured;
  const environment = (readEnv(context, "ENVIRONMENT") ?? "development").toLowerCase();
  if (environment === "production" || environment === "staging") return null;
  return DEV_SECRET;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(mac));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signBookingToken(
  secret: string,
  bookingId: string,
  now: Date,
): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + MAX_AGE_SECONDS;
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ id: bookingId, exp })),
  );
  const mac = await sign(secret, payload);
  return `${payload}.${mac}`;
}

export async function verifyBookingToken(
  secret: string,
  token: string,
  now: Date,
): Promise<{ id: string } | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = await sign(secret, payload);
  if (!timingSafeEqual(mac, expected)) return null;
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  let parsed: { id?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed.id !== "string" || parsed.id.length < 4 || parsed.id.length > 80) return null;
  if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (parsed.exp < nowSeconds || parsed.exp > nowSeconds + MAX_AGE_SECONDS) return null;
  return { id: parsed.id };
}
