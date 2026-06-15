/**
 * Shared HTML/text helpers for email templates. These were previously copy-
 * pasted (byte-identical) across every template under ./templates; consolidated
 * here so a single definition drives all of them. Behavior is unchanged.
 */

/** Extract the first whitespace-delimited word from a name, with a fallback. */
export function firstNameOrFallback(
  name: string | null | undefined,
  fallback: string,
): string {
  if (!name) return fallback;
  const first = name.trim().split(/\s+/)[0];
  return first || fallback;
}

/** Escape the three HTML-significant characters for use in element text. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape for use inside a double-quoted HTML attribute value. */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
