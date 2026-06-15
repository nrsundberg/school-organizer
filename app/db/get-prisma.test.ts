/**
 * Per-request Prisma client lifetime.
 *
 * Cloudflare Workers binds every Promise to the request I/O context that
 * created it. Prisma's client-side query engine batches queries via a
 * `Promise.resolve().then(...)` microtask; if one PrismaClient instance is
 * shared by two concurrent requests, that batch microtask resolves promises
 * belonging to a *different* request — the "promise was resolved or rejected
 * from a different request context" warning, surfaced under rapid clicking.
 *
 * The contract these tests pin down: one base client per request context,
 * reused within the request, never shared across requests — even when two
 * requests carry the *same* D1 binding object (the exact condition the old
 * module-level, binding-keyed cache mishandled).
 *
 * The real PrismaClient drags in the WASM query engine, so we inject a
 * lightweight construction seam and assert on identity instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "../db.server";

function makeContext(d1: object) {
  return { cloudflare: { env: { D1_DATABASE: d1 } } };
}

function countingFactory() {
  let built = 0;
  const factory = () =>
    ({ __client: ++built, $extends: () => ({ __extended: built }) }) as never;
  return { factory, built: () => built };
}

test("getPrisma reuses one base client within a single request context", () => {
  const ctx = makeContext({ binding: "d1" });
  const { factory, built } = countingFactory();

  const a = getPrisma(ctx, undefined, factory);
  const b = getPrisma(ctx, undefined, factory);

  assert.equal(a, b, "repeat calls in one request must return the same client");
  assert.equal(built(), 1, "client is constructed once per request");
});

test("getPrisma does not share a client across distinct request contexts with the same D1 binding", () => {
  const d1 = { binding: "shared-across-requests" };
  const reqA = makeContext(d1);
  const reqB = makeContext(d1);
  const { factory, built } = countingFactory();

  const a = getPrisma(reqA, undefined, factory);
  const b = getPrisma(reqB, undefined, factory);

  assert.notEqual(a, b, "two requests must each get their own client");
  assert.equal(built(), 2, "one client constructed per request context");
});

test("getPrisma still throws when the D1 binding is missing", () => {
  assert.throws(
    () => getPrisma({ cloudflare: { env: {} } }, undefined, countingFactory().factory),
    /D1_DATABASE/,
  );
});
