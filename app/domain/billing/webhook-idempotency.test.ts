import test from "node:test";
import assert from "node:assert/strict";
import { handleWebhookWithIdempotency } from "./webhook-idempotency.server";

/**
 * Minimal in-memory fake that mimics the Prisma stripeWebhookEvent delegate
 * methods used by handleWebhookWithIdempotency.
 */
function makeDb(initial?: { processedAt: Date | null; lastError?: string | null }) {
  const store: {
    processedAt: Date | null;
    lastError: string | null;
  } = {
    processedAt: initial?.processedAt ?? null,
    lastError: initial?.lastError ?? null,
  };

  const stripeWebhookEvent = {
    async upsert(args: {
      where: { stripeEventId: string };
      create: { stripeEventId: string; type: string; payload: unknown };
      update: Record<string, never>;
      select: { processedAt: true };
    }) {
      // Simulate: create if not exists, return select.processedAt
      return { processedAt: store.processedAt };
    },
    async update(args: {
      where: { stripeEventId: string };
      data: { processedAt?: Date; lastError?: string | null };
    }) {
      if (args.data.processedAt !== undefined) {
        store.processedAt = args.data.processedAt;
      }
      if ("lastError" in args.data) {
        store.lastError = args.data.lastError ?? null;
      }
    },
    _store: store,
  };

  return { stripeWebhookEvent };
}

test("first call: side effect runs once, processedAt is stamped", async () => {
  const db = makeDb();
  let callCount = 0;
  const sideEffect = async () => { callCount++; };

  const result = await handleWebhookWithIdempotency(
    db as any,
    "evt_001",
    "customer.subscription.updated",
    {},
    sideEffect,
  );

  assert.equal(result.status, "success");
  assert.equal(callCount, 1);
  assert.ok(
    db.stripeWebhookEvent._store.processedAt instanceof Date,
    "processedAt should be set after success",
  );
  assert.equal(db.stripeWebhookEvent._store.lastError, null);
});

test("second call: already_processed returned, side effect does not run again", async () => {
  // Simulate a row that was already processed
  const db = makeDb({ processedAt: new Date("2026-01-01T00:00:00Z") });
  let callCount = 0;
  const sideEffect = async () => { callCount++; };

  const result = await handleWebhookWithIdempotency(
    db as any,
    "evt_001",
    "customer.subscription.updated",
    {},
    sideEffect,
  );

  assert.equal(result.status, "already_processed");
  assert.equal(callCount, 0, "side effect must NOT run on duplicate delivery");
});

test("side effect throws: processedAt stays null, lastError is recorded, result is error", async () => {
  const db = makeDb();
  const boom = new Error("stripe API timeout");
  const sideEffect = async () => { throw boom; };

  const result = await handleWebhookWithIdempotency(
    db as any,
    "evt_002",
    "invoice.payment_failed",
    {},
    sideEffect,
  );

  assert.equal(result.status, "error");
  assert.equal((result as any).error, boom);
  assert.equal(
    db.stripeWebhookEvent._store.processedAt,
    null,
    "processedAt must remain null on failure",
  );
  assert.equal(
    db.stripeWebhookEvent._store.lastError,
    "stripe API timeout",
    "lastError should capture the thrown message",
  );
});

test("retry after failure succeeds and stamps processedAt", async () => {
  // Simulates: first call failed (processedAt=null, lastError set), retry now succeeds.
  const db = makeDb({ processedAt: null, lastError: "previous error" });
  let callCount = 0;
  const sideEffect = async () => { callCount++; };

  const result = await handleWebhookWithIdempotency(
    db as any,
    "evt_003",
    "customer.subscription.created",
    {},
    sideEffect,
  );

  assert.equal(result.status, "success");
  assert.equal(callCount, 1, "side effect should run on retry");
  assert.ok(
    db.stripeWebhookEvent._store.processedAt instanceof Date,
    "processedAt should be stamped after successful retry",
  );
  assert.equal(db.stripeWebhookEvent._store.lastError, null, "lastError cleared on success");
});
