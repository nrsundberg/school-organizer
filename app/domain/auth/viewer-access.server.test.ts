import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeViewerMagicLink,
  hasValidViewerAccess,
} from "./viewer-access.server";
import { VIEWER_SESSION_DAYS } from "./viewer-access.constants";

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

// --- consumeViewerMagicLink: reusable (multi-use) magic link ---
//
// The link is shared with all faculty; each device redeems it to mint its own
// viewer session. It is bounded only by expiry and admin revocation — NOT by a
// single-use flag. These tests thread an explicit prisma (same pattern as
// hasValidViewerAccess) so consume never touches context.

type FakeMagicLinkRow = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  usedAt: Date | null;
};

function fakeMagicLinkPrisma(row: FakeMagicLinkRow | null) {
  const createdSessions: Array<{ expiresAt: Date }> = [];
  const prisma = {
    viewerMagicLink: {
      findFirst: async () => row,
      // Records the last-redeemed marker; non-blocking.
      update: async ({ data }: { data: { usedAt: Date } }) => {
        if (row) row.usedAt = data.usedAt;
        return row;
      },
    },
    viewerAccessSession: {
      create: async ({ data }: { data: { expiresAt: Date } }) => {
        createdSessions.push({ expiresAt: data.expiresAt });
        return data;
      },
    },
  } as unknown as ReturnType<
    typeof import("~/domain/utils/global-context.server").getTenantPrisma
  >;
  return { prisma, createdSessions };
}

const consumeCtx = {
  request: new Request("https://tome.pickuproster.com/viewer-access?token=raw"),
  context: {},
};

test("magic link is multi-use: redeeming the same link twice both succeed", async () => {
  const row: FakeMagicLinkRow = {
    id: "ml_1",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    usedAt: null,
  };
  const { prisma, createdSessions } = fakeMagicLinkPrisma(row);

  const first = await consumeViewerMagicLink(consumeCtx, "raw", prisma);
  const second = await consumeViewerMagicLink(consumeCtx, "raw", prisma);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // Each redemption mints its own device session.
  assert.equal(createdSessions.length, 2);
});

test("each redeemed session lasts VIEWER_SESSION_DAYS (~300 days)", async () => {
  const row: FakeMagicLinkRow = {
    id: "ml_2",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    usedAt: null,
  };
  const { prisma, createdSessions } = fakeMagicLinkPrisma(row);

  const before = Date.now();
  const result = await consumeViewerMagicLink(consumeCtx, "raw", prisma);
  assert.equal(result.ok, true);

  const expectedMs = VIEWER_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const actualMs = createdSessions[0].expiresAt.getTime() - before;
  // Allow a small slop for the ms elapsed inside the call.
  assert.ok(
    Math.abs(actualMs - expectedMs) < 5_000,
    `expected session ~${VIEWER_SESSION_DAYS} days out, got ${actualMs}ms`,
  );
  assert.equal(VIEWER_SESSION_DAYS, 300);
});

test("revoked magic link is refused", async () => {
  const row: FakeMagicLinkRow = {
    id: "ml_3",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: new Date(Date.now() - 1000),
    usedAt: null,
  };
  const { prisma, createdSessions } = fakeMagicLinkPrisma(row);

  const result = await consumeViewerMagicLink(consumeCtx, "raw", prisma);
  assert.equal(result.ok, false);
  assert.equal(createdSessions.length, 0);
});

test("expired magic link is refused", async () => {
  const row: FakeMagicLinkRow = {
    id: "ml_4",
    expiresAt: new Date(Date.now() - 1000),
    revokedAt: null,
    usedAt: null,
  };
  const { prisma, createdSessions } = fakeMagicLinkPrisma(row);

  const result = await consumeViewerMagicLink(consumeCtx, "raw", prisma);
  assert.equal(result.ok, false);
  assert.equal(createdSessions.length, 0);
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
