# Stripe products to create

Price IDs are **not** in the repo. Checkout reads them from Worker secrets. Amounts live in [`app/domain/billing/public-prices.ts`](../app/domain/billing/public-prices.ts). Create the Prices with:

```sh
STRIPE_SECRET_KEY=sk_test_... npm run stripe:create-prices
# preview without writing:
STRIPE_SECRET_KEY=sk_test_... npm run stripe:create-prices -- --dry-run
# live mode requires an explicit flag:
STRIPE_SECRET_KEY=sk_live_... npm run stripe:create-prices -- --live
```

The script finds or creates a Product tagged `metadata.billingPlan` = `CAR_LINE` or `CAMPUS`, then finds or creates a Price with the amount and interval below. It prints each Price ID. Re-running reuses a Price that already matches; it does not guess an ID from a differently priced Price.

You can also create them by hand in the [Stripe Dashboard](https://dashboard.stripe.com/) (Products → Add product). Do **not** add a Stripe trial (`trial_period_days`) on these Prices.

## Products and prices

| Product | Amount | Interval | Env var | `billingPlan` |
|---------|--------|----------|---------|---------------|
| **Car Line** | **$150.00 USD** | month | `STRIPE_CAR_LINE_PRICE_ID` | `CAR_LINE` |
| **Car Line** | **$1,440.00 USD** (20% off $1,800) | year | `STRIPE_CAR_LINE_ANNUAL_PRICE_ID` | `CAR_LINE` |
| **Campus** | **$500.00 USD** | month | `STRIPE_CAMPUS_PRICE_ID` | `CAMPUS` |
| **Campus** | **$4,800.00 USD** (20% off $6,000) | year | `STRIPE_CAMPUS_ANNUAL_PRICE_ID` | `CAMPUS` |

**District** stays custom. There is no self-serve Stripe Price. `ENTERPRISE` is not sold via checkout.

Currency is USD. Quantity is 1 per school. Annual checkout refuses to run if the annual Price ID is missing — it will not silently charge the monthly Price.

## Trial (no card)

Self-serve signup does **not** open Checkout and does **not** collect a card. `ensureOrgForUser` (and district signup) sets `status = TRIALING` and `trialEndsAt` to **30 calendar days** after signup. The daily cron suspends the org when that timestamp passes and the org has not converted.

The older “later of 30 calendar days or 25 qualifying pickup days” rule still exists in `evaluateTrial` / `trial-lifecycle.server.ts`, but it only runs for `billingPlan = FREE`. Public signup stores `CAR_LINE`, `CAMPUS`, or `DISTRICT`, so that extension does not lengthen a new school's trial. Marketing copy describes the 30-calendar-day rule.

## Environment variables

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Secret API key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `https://<host>/api/webhooks/stripe` |
| `STRIPE_CAR_LINE_PRICE_ID` | Car Line **$150/month** Price ID |
| `STRIPE_CAR_LINE_ANNUAL_PRICE_ID` | Car Line **$1,440/year** Price ID |
| `STRIPE_CAMPUS_PRICE_ID` | Campus **$500/month** Price ID |
| `STRIPE_CAMPUS_ANNUAL_PRICE_ID` | Campus **$4,800/year** Price ID |

Set each secret for production and staging:

```sh
npx wrangler secret put STRIPE_CAR_LINE_PRICE_ID
npx wrangler secret put STRIPE_CAR_LINE_ANNUAL_PRICE_ID --env staging
```

Repeat for the other three Price IDs, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`, once per environment (`--env staging` vs production).

**Local / dev:** `STRIPE_STARTER_PRICE_ID` still fills in **both** monthly Price IDs when the specific ones are empty, so one test Price can exercise monthly checkout. It does not satisfy annual checkout.

## Other optional secrets

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Already required for welcome and other mail. Signup alerts use the same Resend + `EMAIL_QUEUE` path. |
| `SIGNUP_NOTIFY_EMAIL` | Optional. Defaults to `NoahSundberg@gmail.com`. |
| `INTRO_CALL_BOOKING_URL` | Optional http(s) URL for the two free intro calls. Leave unset until a calendar exists. The UI shows no link rather than a placeholder. |

```sh
npx wrangler secret put INTRO_CALL_BOOKING_URL
npx wrangler secret put SIGNUP_NOTIFY_EMAIL
```

## Webhook

Subscribe to at least:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.completed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

The handler maps the subscription’s **first line item’s price** to `CAR_LINE` or `CAMPUS` by comparing `price.id` to the monthly and annual env vars.

## Plan limits (reference)

Defined in [`app/lib/plan-limits.ts`](../app/lib/plan-limits.ts):

- **FREE** / **Car Line:** 400 students, 150 families, 35 classrooms
- **Campus:** 900 students, 300 families, 80 classrooms
- **Enterprise:** unlimited (no numeric enforcement in app)

Grace behavior: warn at **80%** of any cap; **30 days** after first exceeding **100%** on any cap, growth above **100%** is blocked unless the org upgrades or reduces usage; up to **110%** of each cap is allowed during that grace window.
