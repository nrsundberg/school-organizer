# Platform: comps and Stripe promotion codes

Internal notes for staff granting complimentary access.

## Stripe Promotion Codes

Use the Stripe Dashboard to create **Promotion codes** tied to **Coupons** (percent off, amount off, or duration). Share codes with customers during checkout, or apply coupons to existing subscriptions from the customer page. See Stripe’s docs: [Promotion codes](https://stripe.com/docs/billing/subscriptions/discounts).

## Manual comp via org billing

For full control (e.g. enterprise handshake, migration), org billing fields can be updated to reflect a complimentary tier. A future **platform API** route may expose audited updates to `Org` billing fields (`billingPlan`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, etc.) so staff do not need raw DB access.

If the schema lacks fields you need for tracking comp reasons or expiry, add them in a migration first; until then, document the case in your support tracker.
