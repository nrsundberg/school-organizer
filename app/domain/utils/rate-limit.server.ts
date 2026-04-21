export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * Extract a named RateLimit binding from a React Router / Cloudflare Workers
 * context object.  The context is typed as `any` here to match the pattern
 * used by `getPrisma` and other helpers in this codebase — the real type lives
 * in `env.d.ts`.
 */
export function getRateLimiter(
  context: any,
  name: string,
): RateLimit | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return context?.cloudflare?.env?.[name] as RateLimit | undefined;
}

/**
 * Call the Cloudflare Workers rate_limit binding and return a typed result.
 *
 * If `limiter` is undefined (e.g. local dev without the binding wired) the
 * function defaults to allowing the request (`defaultAllow: true`).  Set
 * `defaultAllow: false` to default-deny in that case.
 */
export async function checkRateLimit(params: {
  limiter: RateLimit | undefined;
  key: string;
  /** When the binding is absent, allow by default (safe for local dev). */
  defaultAllow?: boolean;
}): Promise<RateLimitResult> {
  const { limiter, key, defaultAllow = true } = params;

  if (!limiter) {
    return defaultAllow ? { ok: true } : { ok: false, retryAfter: 60 };
  }

  const { success } = await limiter.limit({ key });
  return success ? { ok: true } : { ok: false, retryAfter: 60 };
}

/**
 * Extract a stable client IP from Cloudflare request headers.
 *
 * Priority:
 *   1. `CF-Connecting-IP`  — set by Cloudflare's edge for every proxied request
 *   2. First hop of `X-Forwarded-For`
 *   3. `"unknown"` as a final fallback
 */
export function clientIpFromRequest(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();

  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0];
    if (first) return first.trim();
  }

  return "unknown";
}
