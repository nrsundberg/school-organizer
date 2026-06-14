import { PrismaClient } from "./db/generated/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { tenantExtension } from "./db/tenant-extension";

/**
 * One base PrismaClient **per request**, not per isolate.
 *
 * Cloudflare Workers binds every Promise to the request I/O context that
 * created it. Prisma's client-side query engine batches queries through a
 * `Promise.resolve().then(...)` microtask. A single client shared by two
 * concurrent requests in the same isolate lets that batch microtask resolve
 * promises belonging to a *different* request — the "promise was resolved or
 * rejected from a different request context" warning seen under rapid
 * clicking, with canceled continuations that can intermittently drop a query.
 *
 * Keying the client on the per-request `context` object (a fresh
 * `RouterContextProvider` per fetch in workers/app.ts) keeps each request's
 * queries on their own client, while repeat calls within one request still
 * reuse it. The WeakMap means clients are collected when the request context
 * is — no manual teardown.
 */
const REQUEST_CLIENT = new WeakMap<object, PrismaClient>();

// Fallback key for the rare caller that has no per-request object (e.g. a
// bare `process.env` shim in local tooling). Such callers are single-threaded
// so a shared client is safe there.
const FALLBACK_KEY: object = {};

export function requestKey(context: any): object {
  return context && typeof context === "object" ? context : FALLBACK_KEY;
}

/**
 * Construction seam. Overridable so tests can assert the per-request
 * memoization contract without spinning up the WASM-backed query engine.
 */
export function createBaseClient(d1: unknown): PrismaClient {
  return new PrismaClient({ adapter: new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]) });
}

export function getPrisma(
  context: any,
  orgId?: string,
  makeClient: (d1: unknown) => PrismaClient = createBaseClient,
): PrismaClient {
  if (!context?.cloudflare?.env?.D1_DATABASE) {
    throw new Error(
      "getPrisma: D1_DATABASE binding not found. Run via `wrangler dev` or check your Cloudflare environment."
    );
  }
  const d1 = context.cloudflare.env.D1_DATABASE;
  const key = requestKey(context);
  let base = REQUEST_CLIENT.get(key);
  if (!base) {
    base = makeClient(d1);
    REQUEST_CLIENT.set(key, base);
  }
  return orgId
    ? (base.$extends(tenantExtension(orgId)) as unknown as PrismaClient)
    : base;
}
