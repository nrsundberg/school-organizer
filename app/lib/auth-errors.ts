/**
 * Map better-auth error codes to translation keys under `errors:auth.*`.
 *
 * Better-auth surfaces failures via either:
 *   - a structured `{ error: { code, message } }` shape on the client SDK
 *     (`signIn.email`, `signUp.email`, etc.)
 *   - a thrown `BetterAuthError` server-side
 *
 * We translate at the *display* boundary (route components / actions). This
 * file owns the code → key map; route code calls `translateAuthError(code, t)`
 * with a `t` already pinned to the request locale.
 *
 * Phase 2 Agent A's auth route components hard-code their own error strings
 * (e.g. `t("auth:login.errors.invalidPassword")`) at the moment — Phase 2.5
 * cleanup can swap them for `translateAuthError(...)` once the better-auth
 * SDK reliably exposes structured codes (which depends on better-auth
 * version + plugin config). The helper is exported here so that work has a
 * stable target.
 *
 * See `docs/i18n-contract.md` ("Out of scope") — we map at the boundary, we
 * do not patch better-auth internals upstream.
 */

import type { TFunction } from "i18next";

/**
 * Better-auth's documented error codes (v1.x). When a code isn't in this map,
 * `translateAuthError` falls back to the supplied raw message (preserved for
 * the rare case better-auth surfaces something we haven't enumerated) or a
 * generic translated unknown-error message.
 *
 * Source codes pulled from the better-auth docs / changelog. Keep the keys
 * stable — they're part of the contract with the JSON resource files.
 */
export const BETTER_AUTH_ERROR_KEYS: Record<string, string> = {
  // Sign-in
  INVALID_EMAIL_OR_PASSWORD: "errors:auth.invalidEmailOrPassword",
  INVALID_PASSWORD: "errors:auth.invalidEmailOrPassword",
  INVALID_EMAIL: "errors:auth.invalidEmailOrPassword",
  USER_NOT_FOUND: "errors:auth.userNotFound",
  // Sign-up
  USER_ALREADY_EXISTS: "errors:auth.userAlreadyExists",
  EMAIL_ALREADY_EXISTS: "errors:auth.userAlreadyExists",
  PASSWORD_TOO_SHORT: "errors:auth.passwordTooShort",
  PASSWORD_TOO_LONG: "errors:auth.passwordTooLong",
  // Verification / recovery
  EMAIL_NOT_VERIFIED: "errors:auth.emailNotVerified",
  INVALID_TOKEN: "errors:auth.invalidToken",
  EXPIRED_TOKEN: "errors:auth.tokenExpired",
  TOKEN_EXPIRED: "errors:auth.tokenExpired",
  // Session / account
  SESSION_EXPIRED: "errors:auth.sessionExpired",
  ACCOUNT_BANNED: "errors:auth.accountBanned",
  USER_BANNED: "errors:auth.accountBanned",
  // Rate limiting
  TOO_MANY_REQUESTS: "errors:auth.rateLimited",
  RATE_LIMIT_EXCEEDED: "errors:auth.rateLimited",
};

/**
 * Translate a better-auth error.
 *
 * @param code  The better-auth error code (from `result.error.code`). When
 *              the SDK only returns a string message, callers can pass
 *              `null`/`undefined` and rely on `fallback`.
 * @param t     A pre-resolved `t` function (typically pinned to the `errors`
 *              namespace via `getFixedT(locale, "errors")`).
 * @param fallback  Optional raw message to use when no code maps. Useful when
 *                  better-auth surfaces a server-side `result.error.message`
 *                  we haven't enumerated yet — better than swallowing it.
 */
export function translateAuthError(
  code: string | null | undefined,
  t: TFunction,
  fallback?: string | null,
): string {
  if (code) {
    const key = BETTER_AUTH_ERROR_KEYS[code];
    if (key) return t(key);
  }
  if (fallback && fallback.trim().length > 0) return fallback;
  return t("errors:auth.unknownError");
}

/**
 * Type guard that pulls a `{ code, message }` pair off whatever shape the
 * better-auth client returns. Safe to call on anything — the SDK has changed
 * its error shape across minor versions.
 */
export function readAuthErrorShape(err: unknown): {
  code: string | null;
  message: string | null;
} {
  if (!err || typeof err !== "object") {
    return { code: null, message: typeof err === "string" ? err : null };
  }
  const e = err as Record<string, unknown>;
  const code =
    typeof e.code === "string"
      ? (e.code as string)
      : typeof (e as any).error?.code === "string"
        ? ((e as any).error.code as string)
        : null;
  const message =
    typeof e.message === "string"
      ? (e.message as string)
      : typeof (e as any).error?.message === "string"
        ? ((e as any).error.message as string)
        : null;
  return { code, message };
}
