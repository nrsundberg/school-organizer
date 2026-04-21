/** Product name on marketing routes and when no org is in context. */
export const DEFAULT_SITE_NAME = "Pickup Roster";

/** Fallback support email when `SUPPORT_EMAIL` env is not set. */
export const DEFAULT_SUPPORT_EMAIL = "support@pickuproster.com";

function readEnv(context: any, key: string): string | undefined {
  return context?.cloudflare?.env?.[key] ?? process.env[key];
}

/**
 * Resolve the support email from the request context.
 *
 * Reads `context.cloudflare.env.SUPPORT_EMAIL`, then falls back to
 * `process.env.SUPPORT_EMAIL`, then to `DEFAULT_SUPPORT_EMAIL`.
 */
export function getSupportEmail(context: any): string {
  return readEnv(context, "SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
}
