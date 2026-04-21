/**
 * Client-safe branding constants and pure helpers.
 *
 * This module is intentionally NOT a `.server.ts` file: React Router only
 * strips `.server` imports from the server-only route exports
 * (`loader`, `action`, `middleware`, `headers`). Anything referenced from
 * `links()`, `meta()`, `ErrorBoundary`, or the default component export must
 * live in a client-safe module — otherwise the commonjs-resolver will refuse
 * to build the route.
 *
 * The server-only `branding.server.ts` re-exports everything here for
 * backward compatibility, so existing server-side imports keep working.
 */

export const DEFAULT_LOGO_URL = "/logo-icon.svg";
export const DEFAULT_BRAND_PRIMARY = "#60A5FA";
export const DEFAULT_BRAND_ACCENT = "#E9D500";
/** Defaults for the palette override feature (separate from brand chrome). */
export const DEFAULT_PRIMARY_COLOR = "#3D6B9A";
export const DEFAULT_SECONDARY_COLOR = "#A86C10";

/**
 * Shared hex color guard. Accepts only the compact 6-digit form `#RRGGBB`.
 * Used in both the admin action (reject bad form input) and the root default
 * export (strip anything we wouldn't safely inject into a `<style>` tag), so
 * it must be available on both sides of the server/client boundary.
 */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/**
 * Returns the trimmed upper-case hex string if valid, otherwise null.
 * Centralizes the XSS guard: anything that doesn't match this regex must not
 * be written to the DB and must not be injected into CSS.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  return HEX_COLOR_RE.test(value) ? value.toUpperCase() : null;
}
