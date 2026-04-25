/**
 * Minimal, type-safe `{{ var }}` interpolation for email templates.
 *
 * Keeps things dependency-free. If a variable is referenced in the template
 * but missing from `vars`, the placeholder is left as-is and a warning is
 * logged — that surfaces mistakes without breaking sends in prod.
 *
 * Status (Phase 2 i18n): the email template renderers in
 * `templates/{welcome,password-reset,mid-trial-checkin,trial-expiring}.ts`
 * now resolve copy through i18next (`getFixedT(locale, "email")`), which
 * does its own `{{var}}` interpolation. This helper is retained for any
 * future non-translated string assembly (e.g. assembling raw URLs) but is
 * no longer used by the template module. i18next uses the same `{{var}}`
 * placeholder syntax — no conflict.
 */

export type InterpolateVars = Record<string, string | number | null | undefined>;

const TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function interpolate(template: string, vars: InterpolateVars): string {
  return template.replace(TOKEN_RE, (match, name: string) => {
    if (!(name in vars)) {
      console.warn(`[email interpolate] missing var: ${name}`);
      return match;
    }
    const v = vars[name];
    if (v == null) return "";
    return String(v);
  });
}
