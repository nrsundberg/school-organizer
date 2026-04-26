import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInviteUrl } from "./user-invite.server";

/**
 * Smoke tests for the pure helpers. The token create/consume cycle goes
 * through Prisma + D1 and is exercised via the local dev / e2e harness;
 * we don't have a Prisma mock here, so URL building and exhaustive scope
 * checks are the unit-testable surface.
 */

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
