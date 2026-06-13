import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInviteUrl, checkInviteTokenRow } from "./user-invite.server";
import type { InviteTokenRow } from "./user-invite.server";

/**
 * Unit tests for the pure helpers in user-invite.server.ts.
 *
 * The token create/consume cycle goes through Prisma + D1 and is
 * exercised via the local dev / e2e harness; we don't mock the DB here.
 * Instead, `checkInviteTokenRow` (extracted in issue-59 hardening) makes
 * the core validity rules unit-testable without any DB connection.
 */

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days out
const PAST = new Date(Date.now() - 1); // 1 ms ago

function makeRow(overrides: Partial<InviteTokenRow> = {}): InviteTokenRow {
  return {
    id: "tok-id-1",
    userId: "user-id-1",
    expiresAt: FUTURE,
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkInviteTokenRow — pure validity rules
// ---------------------------------------------------------------------------

describe("checkInviteTokenRow", () => {
  it("returns ok:true for a valid, unused, un-revoked, non-expired row", () => {
    const row = makeRow();
    const result = checkInviteTokenRow(row);
    assert.ok(result.ok);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.tokenId, row.id);
    assert.equal(result.userId, row.userId);
    assert.deepEqual(result.expiresAt, row.expiresAt);
  });

  it("returns not-found when row is null", () => {
    const result = checkInviteTokenRow(null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "not-found");
  });

  it("returns used when usedAt is set — enforces the single-use contract", () => {
    // This is the key invariant: once consumeInviteToken stamps usedAt, a
    // second call (or any subsequent lookup) must return { ok: false, reason: "used" }.
    const row = makeRow({ usedAt: new Date() });
    const result = checkInviteTokenRow(row);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "used");
  });

  it("returns revoked when revokedAt is set", () => {
    const row = makeRow({ revokedAt: new Date() });
    const result = checkInviteTokenRow(row);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "revoked");
  });

  it("returns expired when expiresAt <= now", () => {
    const row = makeRow({ expiresAt: PAST });
    const result = checkInviteTokenRow(row);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "expired");
  });

  it("usedAt takes precedence over expired — used is surfaced first", () => {
    // A token can be both usedAt-stamped and past expiry (they're independent
    // columns). The check order is usedAt → revokedAt → expired, so the
    // caller sees "used" not "expired".
    const row = makeRow({ usedAt: new Date(), expiresAt: PAST });
    const result = checkInviteTokenRow(row);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "used");
  });

  it("revokedAt takes precedence over expired", () => {
    const row = makeRow({ revokedAt: new Date(), expiresAt: PAST });
    const result = checkInviteTokenRow(row);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "revoked");
  });

  it("token expiring exactly at `now` is treated as expired (not valid)", () => {
    const exactly = new Date(1_000_000);
    const row = makeRow({ expiresAt: exactly });
    // Pass the same timestamp as `now` — expiresAt <= now should reject.
    const result = checkInviteTokenRow(row, exactly);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "expired");
  });

  it("token expiring 1 ms in the future is still valid", () => {
    const now = new Date(1_000_000);
    const row = makeRow({ expiresAt: new Date(1_000_001) });
    const result = checkInviteTokenRow(row, now);
    assert.ok(result.ok);
  });
});

// ---------------------------------------------------------------------------
// buildInviteUrl
// ---------------------------------------------------------------------------

describe("buildInviteUrl", () => {
  it("anchors on the marketing origin and URL-encodes the token", () => {
    const request = new Request("https://demo.pickuproster.com/admin/users");
    const context = {
      cloudflare: {
        env: {
          PUBLIC_ROOT_DOMAIN: "pickuproster.com",
        },
      },
    };
    const url = buildInviteUrl(request, context, "abc def+1");
    assert.equal(
      url,
      "https://pickuproster.com/accept-invite?token=abc%20def%2B1",
    );
  });

  it("preserves the request port for local dev origins", () => {
    const request = new Request("http://demo.localhost:5173/admin");
    const context = { cloudflare: { env: {} } };
    const url = buildInviteUrl(request, context, "tok");
    // Without PUBLIC_ROOT_DOMAIN the helper falls back to "localhost".
    assert.equal(url, "http://localhost:5173/accept-invite?token=tok");
  });
});
