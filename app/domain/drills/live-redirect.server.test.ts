// Unit tests for the live-drill audience-membership gate in
// `app/domain/drills/live-redirect.server.ts`.
//
// The redirect is a pure function of:
//   - membership: caller's category (STAFF | VIEWER_PIN | NONE)
//   - audience:   the active run's audience (STAFF_ONLY | EVERYONE | null)
//   - pathname:   request URL pathname (allow-list short-circuits)
//
// Decision matrix:
//   audience    | STAFF | VIEWER_PIN | NONE
//   ------------+-------+------------+------
//   null        |   ✗   |     ✗      |  ✗    (no active drill — never redirect)
//   STAFF_ONLY  |   ✓   |     ✗      |  ✗
//   EVERYONE    |   ✓   |     ✓      |  ✗
//
// Allow-listed paths (/drills/live, /logout, /set-password, /admin/, /api/,
// /assets/, /build/) ALWAYS short-circuit to null even if the caller is in
// the audience.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  liveDrillRedirectTarget,
  type LiveRedirectInput,
} from "./live-redirect.server";

function call(overrides: Partial<LiveRedirectInput>): string | null {
  return liveDrillRedirectTarget({
    membership: "STAFF",
    audience: "EVERYONE",
    pathname: "/",
    ...overrides,
  });
}

describe("liveDrillRedirectTarget — no active drill", () => {
  it("audience=null + any membership → null", () => {
    assert.equal(call({ membership: "STAFF", audience: null }), null);
    assert.equal(call({ membership: "VIEWER_PIN", audience: null }), null);
    assert.equal(call({ membership: "NONE", audience: null }), null);
  });
});

describe("liveDrillRedirectTarget — STAFF_ONLY drill", () => {
  it("STAFF in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "STAFF_ONLY", pathname: "/" }),
      "/drills/live",
    );
  });

  it("VIEWER_PIN excluded → null", () => {
    assert.equal(
      call({ membership: "VIEWER_PIN", audience: "STAFF_ONLY", pathname: "/" }),
      null,
    );
  });

  it("NONE excluded → null", () => {
    assert.equal(
      call({ membership: "NONE", audience: "STAFF_ONLY", pathname: "/" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — EVERYONE drill", () => {
  it("STAFF in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "EVERYONE", pathname: "/" }),
      "/drills/live",
    );
  });

  it("VIEWER_PIN in audience → /drills/live", () => {
    assert.equal(
      call({ membership: "VIEWER_PIN", audience: "EVERYONE", pathname: "/" }),
      "/drills/live",
    );
  });

  it("NONE never redirected (anonymous handled by other auth flows)", () => {
    assert.equal(
      call({ membership: "NONE", audience: "EVERYONE", pathname: "/" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — allow-list", () => {
  it("STAFF + EVERYONE drill on /drills/live → null (already there)", () => {
    assert.equal(call({ pathname: "/drills/live" }), null);
  });

  it("STAFF + EVERYONE drill on /logout → null", () => {
    assert.equal(call({ pathname: "/logout" }), null);
  });

  it("STAFF + EVERYONE drill on /set-password → null", () => {
    assert.equal(call({ pathname: "/set-password" }), null);
  });

  it("STAFF + EVERYONE drill on /api/* → null", () => {
    assert.equal(call({ pathname: "/api/foo" }), null);
    assert.equal(call({ pathname: "/api/auth/session" }), null);
  });

  it("STAFF + EVERYONE drill on /assets/* or /build/* → null", () => {
    assert.equal(call({ pathname: "/assets/logo.svg" }), null);
    assert.equal(call({ pathname: "/build/index.js" }), null);
  });

  it("STAFF + EVERYONE drill on /admin/* → null (admins keep admin access)", () => {
    assert.equal(call({ pathname: "/admin/drills" }), null);
    assert.equal(call({ pathname: "/admin/billing" }), null);
  });

  it("VIEWER_PIN + EVERYONE drill on /admin/* → null (admin paths never redirect)", () => {
    assert.equal(
      call({ membership: "VIEWER_PIN", pathname: "/admin/drills" }),
      null,
    );
  });
});

describe("liveDrillRedirectTarget — empty path", () => {
  it("empty pathname is treated as '/'", () => {
    assert.equal(
      call({ membership: "STAFF", audience: "EVERYONE", pathname: "" }),
      "/drills/live",
    );
  });
});
