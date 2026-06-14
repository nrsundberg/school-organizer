/**
 * Per-request better-auth instance lifetime.
 *
 * The auth instance wraps a Prisma client (via prismaAdapter). Caching it
 * at module scope across requests pins the request that first built it —
 * its captured Prisma client then services later requests, reintroducing the
 * cross-request promise problem `db.server` now avoids (see
 * app/db/get-prisma.test.ts). So `getAuth` must mirror `getPrisma`: one
 * instance per request context, reused within the request.
 *
 * Building a real better-auth instance drags in the prisma adapter chain, so
 * we inject the builder and assert on identity instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { getAuth } from "./better-auth.server";

function makeContext() {
  const env = {
    D1_DATABASE: {},
    BETTER_AUTH_SECRET: "test-secret",
    ENVIRONMENT: "development",
  };
  return { cloudflare: { env } };
}

function countingBuilder() {
  let built = 0;
  const builder = () => ({ __auth: ++built }) as never;
  return { builder, built: () => built };
}

test("getAuth reuses one instance within a single request context", () => {
  const ctx = makeContext();
  const { builder, built } = countingBuilder();

  const a = getAuth(ctx, builder);
  const b = getAuth(ctx, builder);

  assert.equal(a, b, "repeat calls in one request must return the same auth");
  assert.equal(built(), 1, "auth is built once per request");
});

test("getAuth does not share an instance across distinct request contexts", () => {
  const reqA = makeContext();
  const reqB = makeContext();
  const { builder, built } = countingBuilder();

  const a = getAuth(reqA, builder);
  const b = getAuth(reqB, builder);

  assert.notEqual(a, b, "two requests must each get their own auth");
  assert.equal(built(), 2, "one auth built per request context");
});
