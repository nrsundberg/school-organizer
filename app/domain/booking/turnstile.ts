/**
 * Cloudflare Turnstile siteverify.
 *
 * The widget posts `cf-turnstile-response`. This module checks it with
 * Cloudflare before a booking is saved. When TURNSTILE_SECRET_KEY is missing
 * in development, verification is skipped so local forms still work. In
 * production and staging a missing secret fails closed.
 *
 * Noah creates one managed widget and sets:
 * - TURNSTILE_SITE_KEY (public Worker var)
 * - TURNSTILE_SECRET_KEY (Worker secret)
 * - TURNSTILE_HOSTNAMES (optional comma-separated allowlist)
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileDecision =
  | { ok: true; skipped: boolean }
  | { ok: false; error: "turnstile" };

function readEnv(context: any, key: string): string | undefined {
  const raw = context?.cloudflare?.env?.[key] ?? process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function turnstileSiteKey(context: any): string | null {
  return readEnv(context, "TURNSTILE_SITE_KEY") ?? null;
}

export function turnstileSecret(context: any): string | undefined {
  return readEnv(context, "TURNSTILE_SECRET_KEY");
}

export function turnstileHostnames(context: any, request: Request): string[] {
  const configured = readEnv(context, "TURNSTILE_HOSTNAMES");
  if (configured) {
    return configured
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }
  const root = (readEnv(context, "PUBLIC_ROOT_DOMAIN") ?? "").toLowerCase();
  if (root && root !== "localhost" && !root.endsWith(".localhost")) {
    return [root, `www.${root}`];
  }
  const host = new URL(request.url).hostname.toLowerCase();
  return host ? [host] : [];
}

function environmentName(context: any): string {
  return (readEnv(context, "ENVIRONMENT") ?? "development").toLowerCase();
}

export function turnstileRequired(context: any): boolean {
  if (turnstileSecret(context)) return true;
  const environment = environmentName(context);
  return environment === "production" || environment === "staging";
}

export async function verifyTurnstile(args: {
  secret: string | undefined;
  token: string | undefined;
  remoteIp?: string | null;
  expectedAction: string;
  expectedHostnames: readonly string[];
  environment: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileDecision> {
  const secret = args.secret?.trim();
  if (!secret) {
    const environment = args.environment.toLowerCase();
    if (environment === "production" || environment === "staging") {
      return { ok: false, error: "turnstile" };
    }
    return { ok: true, skipped: true };
  }

  const token = args.token?.trim() ?? "";
  if (token.length === 0 || token.length > 2048) return { ok: false, error: "turnstile" };
  if (args.expectedHostnames.length === 0) return { ok: false, error: "turnstile" };

  const body = new URLSearchParams({ secret, response: token });
  if (args.remoteIp) body.set("remoteip", args.remoteIp);

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await (args.fetchImpl ?? fetch)(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, error: "turnstile" };
    result = await response.json();
  } catch {
    return { ok: false, error: "turnstile" };
  }

  const hostname = (result.hostname ?? "").toLowerCase();
  if (
    result.success !== true ||
    result.action !== args.expectedAction ||
    !args.expectedHostnames.includes(hostname)
  ) {
    return { ok: false, error: "turnstile" };
  }
  return { ok: true, skipped: false };
}

export async function verifyTurnstileFromContext(args: {
  context: any;
  request: Request;
  token: string | undefined;
  expectedAction: string;
  remoteIp?: string | null;
}): Promise<TurnstileDecision> {
  return verifyTurnstile({
    secret: turnstileSecret(args.context),
    token: args.token,
    remoteIp: args.remoteIp,
    expectedAction: args.expectedAction,
    expectedHostnames: turnstileHostnames(args.context, args.request),
    environment: environmentName(args.context),
  });
}
