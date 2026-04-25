/**
 * Server-side translation-ready message contract.
 *
 * Server-domain functions (anything under `app/domain/**`) MUST NOT call
 * `t()` themselves — by the time they run, the request locale has been
 * detected at the route boundary, and translating in two places is exactly
 * how copy ends up half-Spanish. Instead, server functions return
 * {@link ServerMessage} objects: a fully-qualified i18next key plus an
 * optional params bag for interpolation. The action / loader wrapper at
 * the route boundary calls `t(message.key, message.params ?? {})` and
 * hands the resolved string to remix-toast / `dataWithError` / etc.
 *
 * The contract is documented in `docs/i18n-contract.md` under
 * "Server-side message contract". Keep this module and that section in
 * sync.
 *
 * Example:
 *
 * ```ts
 * // In a server function:
 * return {
 *   ok: false,
 *   error: { key: "errors:households.invalidStudent" },
 * };
 *
 * // In the route action:
 * const result = await doThing(formData);
 * if (!result.ok) {
 *   return dataWithError(null, t(result.error.key, result.error.params ?? {}));
 * }
 * ```
 */

/** Translation-ready message: a fully-qualified key plus optional params. */
export type ServerMessage = {
  /**
   * Fully-qualified i18next key, e.g. `"errors:households.invalidRoom"` or
   * `"admin:users.errors.notFound"`. Always includes the namespace prefix
   * so route action wrappers don't have to know which namespace to ask
   * for.
   */
  key: string;
  /**
   * Interpolation values. Mirrors the `t()` second-argument shape — keys
   * appear in the JSON template as `{{name}}`. Stay primitive: strings or
   * numbers. Don't pass user-generated data here unless it's safe to
   * surface inside a translated string.
   */
  params?: Record<string, string | number>;
};

/**
 * Discriminated result of a server function that may surface a message
 * to the user.
 *
 * - On success: `data` holds the function's return value, and an optional
 *   `successMessage` carries a translation-ready toast for the route to
 *   render with `dataWithSuccess` (or its warning equivalent).
 * - On failure: `error` carries the translation-ready message — usually
 *   under the `errors:*` namespace.
 *
 * Server functions that don't surface user-facing copy can keep their
 * existing return type; only wrap functions whose result reaches the
 * UI.
 */
export type ServerResult<T> =
  | { ok: true; data: T; successMessage?: ServerMessage }
  | { ok: false; error: ServerMessage };
