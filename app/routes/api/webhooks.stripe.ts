import { data } from "react-router";
import type { Route } from "./+types/webhooks.stripe";
import { getPrisma } from "~/db.server";
import { getStripeConfig, requireStripeConfig } from "~/domain/billing/stripe.server";
import { applySubscriptionToOrg } from "~/domain/billing/sync.server";
import { handleWebhookWithIdempotency } from "~/domain/billing/webhook-idempotency.server";
import { captureException } from "~/lib/sentry.server";
import type Stripe from "stripe";

export async function action({ request, context }: Route.ActionArgs) {
  if (!getStripeConfig(context)) {
    return data({ ok: true, skipped: "Stripe not configured." });
  }

  const stripe = requireStripeConfig(context);
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return data({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.client.webhooks.constructEventAsync(
      payload,
      signature,
      stripe.webhookSecret,
    );
  } catch {
    return data({ error: "Invalid webhook signature." }, { status: 400 });
  }

  const db = getPrisma(context);

  let eventPayload: unknown = null;
  try {
    eventPayload = event.data.object;
  } catch {
    // Ignore serialization errors; we still record the event.
  }

  const result = await handleWebhookWithIdempotency(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db as any,
    event.id,
    event.type,
    eventPayload,
    async () => {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await applySubscriptionToOrg(
            context,
            event.data.object as Stripe.Subscription,
          );
          break;
        }
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;

          // Stamp stripeCustomerId on the org if it hasn't been set yet.
          const sessionCustomerId =
            typeof session.customer === "string"
              ? session.customer
              : session.customer && "id" in session.customer
                ? session.customer.id
                : null;
          const metaOrgId = session.metadata?.orgId ?? null;
          if (metaOrgId && sessionCustomerId) {
            const org = await db.org.findUnique({ where: { id: metaOrgId } });
            if (org && !org.stripeCustomerId) {
              await db.org.update({
                where: { id: org.id },
                data: { stripeCustomerId: sessionCustomerId },
              });
            }
          }

          if (session.subscription) {
            const subscriptionId =
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription.id;
            const subscription = await stripe.client.subscriptions.retrieve(
              subscriptionId,
            );
            await applySubscriptionToOrg(context, subscription);
          }
          break;
        }
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer && "id" in invoice.customer
                ? invoice.customer.id
                : null;
          if (customerId) {
            const org = await db.org.findUnique({
              where: { stripeCustomerId: customerId },
            });
            if (org && org.pastDueSinceAt) {
              await db.org.update({
                where: { id: org.id },
                data: { pastDueSinceAt: null },
              });
            }
          }
          break;
        }
        case "invoice.payment_failed": {
          // No-op for now; past_due handling is driven by subscription.updated events.
          break;
        }
        default:
          break;
      }
    },
  );

  if (result.status === "already_processed") {
    return new Response("ok", { status: 200 });
  }

  if (result.status === "error") {
    captureException(result.error);
    return data({ error: "Webhook handler failed." }, { status: 500 });
  }

  return data({ ok: true });
}
