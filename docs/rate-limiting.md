# Rate Limiting — Pickup Roster

## Workers Bindings (in-process)

Two rate limit bindings are configured in `wrangler.jsonc` under the `ratelimits` top-level array (GA as of September 2025):

| Binding      | Namespace ID | Limit     | Period | Guards                                              |
|--------------|--------------|-----------|--------|-----------------------------------------------------|
| `RL_AUTH`    | `1001`       | 10 req    | 60 s   | `POST /login` action, `POST /signup` action (step 3) |
| `RL_BILLING` | `1002`       | 20 req    | 60 s   | `POST /api/billing/checkout`, `POST /api/billing/portal` |

### Key scheme

- Auth routes key on `"auth:<client-ip>"` — rate limit is per IP across both login and signup.
- Billing routes key on `"billing:<orgId>"` when the user has an org, falling back to `"billing:<client-ip>"` — rate limit is per organization.

### Local development behaviour

When the binding is absent (e.g. `wrangler dev` without the binding configured, or unit tests), `checkRateLimit` defaults to `{ ok: true }` (`defaultAllow: true`) so the app continues to work without the Cloudflare runtime. Set `defaultAllow: false` to default-deny in isolated tests.

### On limit exceeded

Routes return HTTP **429** with:
- Body: `{ "error": "Too many attempts. Please try again in a minute." }`
- Header: `Retry-After: 60`

The signup step-3 form renders this as a visible form error via `useActionData`.

---

## Recommended Zone-Level WAF Rules (Cloudflare Dashboard)

Configure these in **Security → WAF → Rate Limiting Rules** for the `pickuproster.com` zone. These act as an outer defence layer before traffic reaches the Worker.

### 1. Stripe webhook flood protection

| Field          | Value                          |
|----------------|--------------------------------|
| Expression     | `http.request.uri.path eq "/api/webhooks/stripe"` |
| Rate           | 300 requests per minute        |
| Scope          | Per IP                         |
| Action         | Block                          |
| Rationale      | Lets legitimate Stripe delivery through while blocking flooding. Stripe sends at most a handful of events per minute per account; 300 is a generous ceiling. |

### 2. Broader login path protection

| Field          | Value                          |
|----------------|--------------------------------|
| Expression     | `http.request.uri.path contains "/login"` |
| Rate           | 30 requests per minute         |
| Scope          | Per IP                         |
| Action         | Block (or Managed Challenge)   |
| Rationale      | Catches credential-stuffing bots before they reach the Worker. The in-process `RL_AUTH` binding applies to the final submitted request only; this zone rule covers repeated page loads and the `/api/check-email` step as well. |

### 3. Global per-IP ceiling

| Field          | Value                          |
|----------------|--------------------------------|
| Expression     | `true` (all paths)             |
| Rate           | 600 requests per minute        |
| Scope          | Per IP                         |
| Action         | Block                          |
| Rationale      | Acts as a backstop against general DDoS or scraping before any path-specific rule fires. |

---

## Implementation files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | `ratelimits` array defining `RL_AUTH` and `RL_BILLING` bindings |
| `env.d.ts` | TypeScript declarations for both `RateLimit` bindings on `Env` |
| `app/domain/utils/rate-limit.server.ts` | `checkRateLimit()` helper + `clientIpFromRequest()` utility |
| `app/domain/utils/rate-limit.test.ts` | Unit tests for the above utilities |
| `app/routes/auth/login.tsx` | Added `action` export with `RL_AUTH` check |
| `app/routes/auth/signup.tsx` | Added `RL_AUTH` check at top of existing `action` |
| `app/routes/api/billing.checkout.ts` | Added `RL_BILLING` check at top of `action` |
| `app/routes/api/billing.portal.ts` | Added `RL_BILLING` check at top of `action` |
