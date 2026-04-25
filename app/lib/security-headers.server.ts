/**
 * HTTP security headers applied to every app Response coming out of the
 * React Router handler in `workers/app.ts`.
 *
 * Design notes
 * ------------
 * - Pure function. We clone headers rather than mutating the incoming
 *   Response so callers upstream don't observe surprise mutations.
 * - We never overwrite a header the route handler already set — loaders
 *   that need a custom `Content-Type` (JSON APIs, file streams, redirects
 *   with their own `Location`) must win. Each header is guarded with
 *   `.has()` before being written.
 * - `Strict-Transport-Security` is skipped in development so `localhost`
 *   and `*.workers.dev` preview URLs don't end up HSTS-pinned in the
 *   browser. All other headers apply in every environment.
 * - CSP ships enforcing. Scripts use a per-request nonce threaded through
 *   React Router SSR; styles keep `'unsafe-inline'` because third-party UI
 *   libraries in this app still inject inline style attributes/tags at
 *   runtime (for example `react-toastify` and `@react-aria` internals).
 *
 * Tests live in `./security-headers.server.test.ts`.
 */

/**
 * Directives shipped on the enforcing `Content-Security-Policy` header.
 *
 * Notable choices:
 * - `img-src` allows `https:` because tenant branding, Stripe, and a few
 *   marketing-page assets point at mixed third-party CDNs. Data + blob
 *   URLs are needed for inline SVG icons and generated QR images.
 * - `connect-src` lists Sentry (error ingest) and Stripe (client SDK
 *   network calls). R2 logos resolve through `/api/branding/logo/:slug`
 *   on our own origin, so `'self'` covers them.
 * - `script-src` is nonce-based so React Router's inline bootstrap and
 *   scroll-restoration scripts can execute without reopening
 *   `'unsafe-inline'`.
 * - `style-src` is explicit instead of falling back to `default-src`. We
 *   currently keep `'unsafe-inline'` there for compatibility with runtime
 *   library behavior; see the file-level comment above.
 * - `frame-src` whitelists Stripe Checkout and Billing so the customer
 *   portal iframes mount.
 * - `frame-ancestors 'none'` is the CSP-level counterpart to
 *   `X-Frame-Options: DENY` and is honored by modern browsers in
 *   preference to the legacy header.
 */
function buildEnforcingCsp(cspNonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${cspNonce}' https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://api.stripe.com",
    "frame-src https://js.stripe.com https://checkout.stripe.com https://billing.stripe.com",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}

const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

const STATIC_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Permissions-Policy",
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")'
  ]
];

function setIfMissing(headers: Headers, name: string, value: string): void {
  if (!headers.has(name)) {
    headers.set(name, value);
  }
}

/**
 * Wrap a Response with the app's security headers.
 *
 * The returned Response is a new instance — status, statusText, and body
 * are preserved verbatim; headers are the incoming set plus any defaults
 * the handler didn't already assert.
 */
export function applySecurityHeaders(
  response: Response,
  env: { ENVIRONMENT?: string },
  cspNonce: string
): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of STATIC_HEADERS) {
    setIfMissing(headers, name, value);
  }

  // HSTS only in prod. Localhost, wrangler dev, and preview workers.dev
  // URLs should not burn HSTS pins into browsers.
  if (env.ENVIRONMENT !== "development") {
    setIfMissing(headers, "Strict-Transport-Security", HSTS_VALUE);
  }

  setIfMissing(headers, "Content-Security-Policy", buildEnforcingCsp(cspNonce));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Exported for tests / diagnostics — lets us assert the exact CSP string
// without duplicating the directive list.
export const __INTERNAL__ = {
  buildEnforcingCsp,
  HSTS_VALUE
};
