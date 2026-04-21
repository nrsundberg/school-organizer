# Stripe products to create

Create these in the [Stripe Dashboard](https://dashboard.stripe.com/) (Products → Add product). Each plan has a **monthly** price; annual prices are optional but recommended.

## Products and prices

| Product name   | Billing | Purpose | Maps to `billingPlan` in app |
|----------------|---------|---------|------------------------------|
| **Car Line**   | Monthly + Annual | Base paid tier — car line + subdomain, lower enrollment caps | `CAR_LINE` |
| **Campus**     | Monthly + Annual | Full campus tier — higher caps (e.g. 300 families / 900 students) | `CAMPUS` |
| **Free trial** | —       | No Stripe product required | `FREE` (trial orgs) |

**Enterprise** (`ENTERPRISE`) is not sold via self-serve checkout in this app; use **Invoice + manual subscription** or a custom Price in Stripe if needed.

## Environment variables

After creating prices, copy each Price ID (`price_...`) into your environment:

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Secret API key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `https://your-domain/api/webhooks/stripe` |
| `STRIPE_CAR_LINE_PRICE_ID` | Recurring **monthly** price for **Car Line** |
| `STRIPE_CAR_LINE_ANNUAL_PRICE_ID` | Recurring **annual** price for **Car Line** (optional) |
| `STRIPE_CAMPUS_PRICE_ID` | Recurring **monthly** price for **Campus** |
| `STRIPE_CAMPUS_ANNUAL_PRICE_ID` | Recurring **annual** price for **Campus** (optional) |

**Local / dev:** you may set only `STRIPE_STARTER_PRICE_ID` — the app falls back to it for **both** Car Line and Campus monthly price IDs so a single test price works. Annual prices have no fallback; leave the annual env vars empty and the `/pricing` page will hide the annual toggle.

## Webhook

Subscribe to at least:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The handler maps the subscription’s **first line item’s price** to `CAR_LINE` or `CAMPUS` by comparing `price.id` to your env vars (both monthly and annual price IDs resolve to the same plan).

## SMS / email add-ons (future)

Do **not** create these until you implement metering: use **Metered** prices or separate Products for “SMS pack” / “Email pack” and attach as subscription items.

## Plan limits (reference)

Defined in [`app/lib/plan-limits.ts`](../app/lib/plan-limits.ts):

- **FREE** / **Car Line:** 400 students, 150 families, 35 classrooms  
- **Campus:** 900 students, 300 families, 80 classrooms  
- **Enterprise:** unlimited (no numeric enforcement in app)

Grace behavior: warn at **80%** of any cap; **30 days** after first exceeding **100%** on any cap, growth above **100%** is blocked unless the org upgrades or reduces usage; up to **110%** of each cap is allowed during that grace window.
