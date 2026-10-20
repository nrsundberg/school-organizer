import { HELP_SESSION_TTL_MS } from "./limits";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** HMAC grant bound to the browser session id. Format: `sessionId.exp.sig`. */
export async function signHelpSession(args: {
  secret: string;
  sessionId: string;
  now: number;
  ttlMs?: number;
}): Promise<string> {
  const exp = args.now + (args.ttlMs ?? HELP_SESSION_TTL_MS);
  const payload = `${args.sessionId}.${exp}`;
  const sig = await signPayload(args.secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyHelpSession(args: {
  secret: string;
  token: string;
  sessionId: string;
  now: number;
}): Promise<boolean> {
  const parts = args.token.split(".");
  if (parts.length !== 3) return false;
  const [sessionId, expRaw, sig] = parts;
  if (!sessionId || !expRaw || !sig) return false;
  if (sessionId !== args.sessionId) return false;
  if (!/^\d+$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= args.now) return false;
  if (exp > args.now + HELP_SESSION_TTL_MS + 60_000) return false;
  const expected = await signPayload(args.secret, `${sessionId}.${expRaw}`);
  return sameString(expected, sig);
}
