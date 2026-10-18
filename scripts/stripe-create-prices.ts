/**
 * Create (or reuse) the Stripe Products and Prices checkout expects.
 *
 * Price IDs are not hardcoded in the app. This script writes them in the
 * Stripe account for STRIPE_SECRET_KEY and prints the Worker secrets to set.
 * Amounts come from app/domain/billing/public-prices.ts:
 *
 *   Car Line   $150.00 USD / month     → STRIPE_CAR_LINE_PRICE_ID
 *   Car Line   $1,440.00 USD / year    → STRIPE_CAR_LINE_ANNUAL_PRICE_ID
 *   Campus     $500.00 USD / month     → STRIPE_CAMPUS_PRICE_ID
 *   Campus     $4,800.00 USD / year    → STRIPE_CAMPUS_ANNUAL_PRICE_ID
 *
 * District is custom and has no Stripe Price.
 *
 * These Prices must NOT include a Stripe trial period. The 30-day no-card
 * trial is granted in the app at signup (Org.trialEndsAt / District status),
 * before any Checkout session exists.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:create-prices
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:create-prices -- --dry-run
 *   STRIPE_SECRET_KEY=sk_live_... npm run stripe:create-prices -- --live
 *
 * Re-running is safe: an active Price on the same product with the same
 * currency, amount, and interval is reused. A lookup_key collision with a
 * different amount does not overwrite that Price; the new Price is created
 * without the lookup_key and its id is printed.
 */
import Stripe from "stripe";
import { STRIPE_PRICE_SPECS, type StripePriceSpec } from "../app/domain/billing/public-prices";

const dryRun = process.argv.includes("--dry-run");
const allowLive = process.argv.includes("--live");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function findProduct(
  stripe: Stripe,
  plan: StripePriceSpec["plan"],
): Promise<Stripe.Product | null> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.products.list({
      limit: 100,
      active: true,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const hit = page.data.find((product) => product.metadata?.billingPlan === plan);
    if (hit) return hit;
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
}

function priceMatches(price: Stripe.Price, spec: StripePriceSpec): boolean {
  return (
    price.active &&
    price.currency === "usd" &&
    price.unit_amount === spec.unitAmountCents &&
    price.recurring?.interval === spec.interval &&
    (price.recurring?.interval_count ?? 1) === 1
  );
}

async function findMatchingPrice(
  stripe: Stripe,
  productId: string,
  spec: StripePriceSpec,
): Promise<Stripe.Price | null> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const hit = page.data.find((price) => priceMatches(price, spec));
    if (hit) return hit;
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
}

async function createPrice(
  stripe: Stripe,
  productId: string,
  spec: StripePriceSpec,
): Promise<Stripe.Price> {
  const base = {
    product: productId,
    currency: "usd",
    unit_amount: spec.unitAmountCents,
    recurring: { interval: spec.interval },
    nickname: `${spec.productName} ${spec.cycle}`,
    metadata: {
      billingPlan: spec.plan,
      billingCycle: spec.cycle,
      app: "pickuproster",
    },
  } satisfies Stripe.PriceCreateParams;

  try {
    return await stripe.prices.create({
      ...base,
      lookup_key: spec.lookupKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/lookup[_ ]?key/i.test(message)) throw err;
    console.warn(
      `lookup_key ${spec.lookupKey} is already used by a different Price. ` +
        "Creating this Price without a lookup_key. Archive the old Price in Stripe if it should no longer be sold.",
    );
    return stripe.prices.create(base);
  }
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    fail(
      "STRIPE_SECRET_KEY is not set. Export a test or live secret key and re-run. This script does not guess existing Price IDs.",
    );
  }
  if (key.startsWith("sk_live_") && !allowLive) {
    fail("Refusing to create live-mode Prices without --live.");
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    fail("STRIPE_SECRET_KEY should start with sk_test_ or sk_live_.");
  }

  const stripe = new Stripe(key);
  const resolved: Array<{ spec: StripePriceSpec; priceId: string; action: string }> = [];

  const specsByProduct = new Map<StripePriceSpec["plan"], StripePriceSpec[]>();
  for (const spec of STRIPE_PRICE_SPECS) {
    const list = specsByProduct.get(spec.plan) ?? [];
    list.push(spec);
    specsByProduct.set(spec.plan, list);
  }

  for (const [plan, specs] of specsByProduct) {
    const sample = specs[0]!;
    let product = await findProduct(stripe, plan);
    if (!product) {
      if (dryRun) {
        console.log(`[dry-run] would create product ${sample.productName} (billingPlan=${plan})`);
        for (const spec of specs) {
          resolved.push({ spec, priceId: "(not created)", action: "would create" });
        }
        continue;
      }
      product = await stripe.products.create({
        name: sample.productName,
        description: sample.productDescription,
        metadata: { billingPlan: plan, app: "pickuproster" },
      });
      console.log(`created product ${product.id} (${sample.productName})`);
    } else {
      console.log(`reusing product ${product.id} (${product.name})`);
    }

    for (const spec of specs) {
      const existing = await findMatchingPrice(stripe, product.id, spec);
      if (existing) {
        resolved.push({ spec, priceId: existing.id, action: "reused" });
        continue;
      }
      if (dryRun) {
        resolved.push({ spec, priceId: "(not created)", action: "would create" });
        continue;
      }
      const created = await createPrice(stripe, product.id, spec);
      resolved.push({ spec, priceId: created.id, action: "created" });
    }
  }

  console.log("\nStripe Prices for PickupRoster\n");
  for (const row of resolved) {
    const dollars = (row.spec.unitAmountCents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    console.log(
      `${row.action.padEnd(12)} ${row.spec.envVar}=${row.priceId}  ${row.spec.productName} ${dollars} / ${row.spec.interval}`,
    );
  }

  console.log(`
Set these on BOTH production and staging (skip any you are reusing unchanged):

  npx wrangler secret put STRIPE_CAR_LINE_PRICE_ID
  npx wrangler secret put STRIPE_CAR_LINE_ANNUAL_PRICE_ID
  npx wrangler secret put STRIPE_CAMPUS_PRICE_ID
  npx wrangler secret put STRIPE_CAMPUS_ANNUAL_PRICE_ID

Do not put a trial_period_days on these Prices. The app trial is 30 calendar
days with no card, applied at signup, before Checkout.
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
