/**
 * Compact, human-readable device label parsed from a raw User-Agent string.
 *
 * Session tables previously rendered the full UA string in a narrow cell with
 * `break-all`, so every row wrapped into many lines and was hard to scan. This
 * collapses a UA into a one-line "<OS> · <Browser>" label (e.g. "iPhone · Safari",
 * "Windows · Edge"); callers keep the full UA available on hover via `title`.
 *
 * Returns plain English (no i18n) — used by the platform-admin session views.
 *
 * Order matters: Edge UAs also contain "Chrome", and Chrome/Android UAs also
 * contain "Safari", so the more specific token is checked first.
 */
export function deviceLabelFromUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown";

  const os = /iphone/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua)
      ? "iPad"
      : /android/i.test(ua)
        ? "Android"
        : /macintosh|mac os/i.test(ua)
          ? "Mac"
          : /windows/i.test(ua)
            ? "Windows"
            : /linux/i.test(ua)
              ? "Linux"
              : null;

  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua) && !/chrome|crios|android/i.test(ua)
          ? "Safari"
          : null;

  if (os && browser) return `${os} · ${browser}`;
  if (os) return os;
  if (browser) return browser;
  return "Browser";
}
