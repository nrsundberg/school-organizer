/**
 * Strip sensitive data from Sentry events before they leave the app.
 *
 * Used by BOTH the server (`workers/app.ts`) and the client
 * (`app/entry.client.tsx`) `beforeSend` hooks, so this module must stay
 * isomorphic — no server-only or Cloudflare imports.
 *
 * What we scrub and why:
 * - Request cookies + the `Cookie`/`Authorization` headers carry the
 *   better-auth session and viewer-session tokens. A captured exception
 *   should never let someone replay a session from the error dashboard.
 * - The request body (`data`) can hold the login password or the viewer
 *   PIN on a failed POST.
 * - Query strings can carry single-use secrets — most importantly the
 *   viewer magic-link `?token=...` (a 6-month access grant) and the
 *   password-reset `?token=...`. Those land in `request.url` /
 *   `request.query_string` on both client and server events.
 *
 * Tests live in `./sentry-scrub.test.ts`.
 */

const SENSITIVE_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "x-csrf-token",
]);

/** Query keys whose values may be secrets. Matched case-insensitively. */
const SENSITIVE_QUERY_KEYS = ["token", "code", "pin", "password", "secret"];

const REDACTED = "[Filtered]";

function isSensitiveQueryKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.some((s) => k === s || k.endsWith(s));
}

/** Redact the values of sensitive params in a raw `a=b&c=d` query string. */
export function redactQueryString(qs: string): string {
  if (!qs) return qs;
  return qs
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return isSensitiveQueryKey(key) ? `${key}=${REDACTED}` : pair;
    })
    .join("&");
}

/**
 * Scrub a Sentry event in place and return it. Typed loosely (the Sentry
 * `Event` shape differs slightly between the cloudflare and react-router
 * SDKs) — we only touch well-known `request` fields defensively.
 */
export function scrubSentryEvent<T>(event: T): T {
  const req = (event as unknown as { request?: Record<string, unknown> })
    .request;
  if (req && typeof req === "object") {
    delete req.cookies;
    // Request body may contain a password or viewer PIN on a failed POST.
    delete req.data;

    const headers = req.headers;
    if (headers && typeof headers === "object") {
      for (const name of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
          delete (headers as Record<string, unknown>)[name];
        }
      }
    }

    if (typeof req.query_string === "string") {
      req.query_string = redactQueryString(req.query_string);
    }

    if (typeof req.url === "string") {
      const q = req.url.indexOf("?");
      if (q !== -1) {
        req.url = req.url.slice(0, q) + "?" + redactQueryString(req.url.slice(q + 1));
      }
    }
  }
  return event;
}
