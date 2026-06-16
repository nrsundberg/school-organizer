import test from "node:test";
import assert from "node:assert/strict";
import { hasValidViewerAccess } from "./viewer-access.server";

/**
 * Regression: the request-scope resolver calls hasValidViewerAccess DURING
 * middleware resolution, before `orgContext` is populated. If the function
 * defaults to resolving the tenant client from context there, getOrgFromContext
 * throws "Org should be available here" and every anonymous board visit 500s
 * (e.g. https://<tenant>.pickuproster.com/). The fix lets the resolver pass an
 * explicit, org-id-built client so context is never read on that path.
 */

// A context whose .get() throws exactly like getOrgFromContext when orgContext
// is unset — proves the explicit-prisma path never touches it.
const hostileContext = {
  get() {
    throw new Error("Org should be available here");
  },
};

test("uses the explicitly-passed prisma and never resolves org from context", async () => {
  const fakePrisma = {
    viewerAccessSession: { findFirst: async () => null },
  } as unknown as ReturnType<typeof import("~/domain/utils/global-context.server").getTenantPrisma>;
  const request = new Request("https://tome.pickuproster.com/"); // no viewer cookie

  // Must NOT throw "Org should be available here".
  const result = await hasValidViewerAccess(
    { request, context: hostileContext },
    fakePrisma,
  );
  assert.equal(result, false);
});

test("honors the explicit prisma's session lookup (valid session → true)", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const fakePrisma = {
    viewerAccessSession: {
      findFirst: async () => ({ revokedAt: null, expiresAt: future }),
    },
  } as unknown as ReturnType<typeof import("~/domain/utils/global-context.server").getTenantPrisma>;
  const request = new Request("https://tome.pickuproster.com/", {
    headers: { cookie: "pickuproster_viewer_session=sometoken" },
  });

  const result = await hasValidViewerAccess(
    { request, context: hostileContext },
    fakePrisma,
  );
  assert.equal(result, true);
});

test("expired session from the explicit prisma → false", async () => {
  const past = new Date(Date.now() - 1000);
  const fakePrisma = {
    viewerAccessSession: {
      findFirst: async () => ({ revokedAt: null, expiresAt: past }),
    },
  } as unknown as ReturnType<typeof import("~/domain/utils/global-context.server").getTenantPrisma>;
  const request = new Request("https://tome.pickuproster.com/", {
    headers: { cookie: "pickuproster_viewer_session=sometoken" },
  });

  const result = await hasValidViewerAccess(
    { request, context: hostileContext },
    fakePrisma,
  );
  assert.equal(result, false);
});
