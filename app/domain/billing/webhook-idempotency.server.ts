/**
 * Pure idempotency logic for Stripe webhook events.
 *
 * Extracted from the route so it can be unit-tested without a real Prisma client.
 * The route handler passes in a `db` shaped like the minimal interface below.
 */

export interface WebhookEventRecord {
  processedAt: Date | null;
}

export interface StripeWebhookEventDelegate {
  upsert(args: {
    where: { stripeEventId: string };
    create: { stripeEventId: string; type: string; payload: unknown };
    update: Record<string, never>;
    select: { processedAt: true };
  }): Promise<WebhookEventRecord>;

  update(args: {
    where: { stripeEventId: string };
    data: { processedAt: Date; lastError?: null } | { lastError: string };
  }): Promise<unknown>;
}

export interface WebhookIdempotencyDb {
  stripeWebhookEvent: StripeWebhookEventDelegate;
}

export type SideEffectFn = () => Promise<void>;

export type IdempotencyResult =
  | { status: "already_processed" }
  | { status: "success" }
  | { status: "error"; error: unknown };

/**
 * handleWebhookWithIdempotency
 *
 * 1. Upserts the event record (create on first call, no-op update on subsequent).
 * 2. If processedAt is already set → returns "already_processed" immediately.
 * 3. Runs the side effect. On success → stamps processedAt.
 * 4. On failure → records lastError, re-throws so the caller can return 500.
 */
export async function handleWebhookWithIdempotency(
  db: WebhookIdempotencyDb,
  eventId: string,
  eventType: string,
  payload: unknown,
  sideEffect: SideEffectFn,
): Promise<IdempotencyResult> {
  // Upsert: creates the row if new, does nothing on conflict.
  const record = await (db.stripeWebhookEvent as any).upsert({
    where: { stripeEventId: eventId },
    create: { stripeEventId: eventId, type: eventType, payload },
    update: {},
    select: { processedAt: true },
  });

  if (record.processedAt !== null && record.processedAt !== undefined) {
    return { status: "already_processed" };
  }

  try {
    await sideEffect();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    await (db.stripeWebhookEvent as any).update({
      where: { stripeEventId: eventId },
      data: { lastError: message },
    });
    return { status: "error", error: err };
  }

  await (db.stripeWebhookEvent as any).update({
    where: { stripeEventId: eventId },
    data: { processedAt: new Date(), lastError: null },
  });

  return { status: "success" };
}
