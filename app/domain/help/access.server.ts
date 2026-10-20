import { verifyTurnstile, type TurnstileDecision } from "~/domain/booking/turnstile";
import { clientIpFromRequest } from "~/domain/utils/rate-limit.server";
import { helpHostAllowed } from "./guardrails";
import { signHelpSession, verifyHelpSession } from "./session-grant";

export type HelpAccess =
  | { ok: true; grant: string | null }
  | { ok: false; status: number; error: string; code: "challenge" | "unconfigured" };

function readSecret(source: unknown): string | undefined {
  const record = source as {
    BETTER_AUTH_SECRET?: string;
    cloudflare?: { env?: { BETTER_AUTH_SECRET?: string } };
  };
  const raw =
    record?.cloudflare?.env?.BETTER_AUTH_SECRET ??
    record?.BETTER_AUTH_SECRET ??
    (typeof process !== "undefined" ? process.env.BETTER_AUTH_SECRET : undefined);
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function environmentName(source: unknown): string {
  const record = source as {
    ENVIRONMENT?: string;
    cloudflare?: { env?: { ENVIRONMENT?: string } };
  };
  const raw =
    record?.cloudflare?.env?.ENVIRONMENT ??
    record?.ENVIRONMENT ??
    (typeof process !== "undefined" ? process.env.ENVIRONMENT : undefined);
  return (typeof raw === "string" ? raw : "development").trim().toLowerCase();
}

/**
 * First message needs a Turnstile token. Later messages reuse an HMAC grant
 * bound to the session id until it expires, then the caller must challenge again.
 */
export async function authorizeHelpChat(args: {
  source: unknown;
  sessionId: string;
  grant: unknown;
  turnstileToken: unknown;
  turnstileRequired: boolean;
  now?: number;
  verify: (token: string) => Promise<TurnstileDecision>;
}): Promise<HelpAccess> {
  const now = args.now ?? Date.now();
  const secret = readSecret(args.source);
  const presented = typeof args.grant === "string" ? args.grant.trim() : "";
  if (secret && presented && (await verifyHelpSession({ secret, token: presented, sessionId: args.sessionId, now }))) {
    return {
      ok: true,
      grant: await signHelpSession({ secret, sessionId: args.sessionId, now }),
    };
  }

  if (!args.turnstileRequired) {
    return {
      ok: true,
      grant: secret ? await signHelpSession({ secret, sessionId: args.sessionId, now }) : null,
    };
  }

  const token = typeof args.turnstileToken === "string" ? args.turnstileToken.trim() : "";
  const checked = token ? await args.verify(token) : { ok: false as const, error: "turnstile" as const };
  if (!checked.ok) {
    return {
      ok: false,
      status: 403,
      code: "challenge",
      error: "Confirm you're a person, then send your message again.",
    };
  }
  if (!secret) {
    return {
      ok: false,
      status: 503,
      code: "unconfigured",
      error: "Help chat isn't available right now. Use the contact form and we'll write back.",
    };
  }
  return {
    ok: true,
    grant: await signHelpSession({ secret, sessionId: args.sessionId, now }),
  };
}

/** Turnstile for /contact and /api/help/ticket. Fails closed outside local dev. */
export async function requireHuman(args: {
  source: unknown;
  request: Request;
  token: unknown;
  expectedAction: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = new URL(args.request.url).hostname.toLowerCase();
  const environment = environmentName(args.source);
  const secret =
    (args.source as { cloudflare?: { env?: { TURNSTILE_SECRET_KEY?: string } }; TURNSTILE_SECRET_KEY?: string })
      ?.cloudflare?.env?.TURNSTILE_SECRET_KEY ??
    (args.source as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY ??
    (typeof process !== "undefined" ? process.env.TURNSTILE_SECRET_KEY : undefined);
  const required = Boolean(secret?.trim()) || environment === "production" || environment === "staging";
  if (!required) return { ok: true };
  if (!helpHostAllowed(host, args.source)) {
    return { ok: false, error: "Confirm you're a person, then try again." };
  }
  const token = typeof args.token === "string" ? args.token : undefined;
  const decision = await verifyTurnstile({
    secret,
    token,
    remoteIp: clientIpFromRequest(args.request),
    expectedAction: args.expectedAction,
    expectedHostnames: [host],
    environment,
  });
  if (!decision.ok) {
    return { ok: false, error: "Confirm you're a person, then try again." };
  }
  return { ok: true };
}
