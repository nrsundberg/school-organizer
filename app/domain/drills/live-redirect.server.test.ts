// Unit tests for the "during a live drill, non-admins are corralled to
// /drills/live" redirect logic in `app/domain/drills/live-redirect.server.ts`.
//
// The module exposes a pure function so we can exercise every branch without
// touching Prisma or the request lifecycle.
//
// Public API under test:
//   liveDrillRedirectTarget({ user, pathname, hasActiveDrill, isAdmin }) => string | null
//   userIsAdmin(user) => boolean
//
// Decision table covered:
//   - Signed-out user                                → null
//   - Admin / Controller                             → null
//   - No active drill                                → null
//   - Allow-listed path (/drills/live, /logout, /set-password)  → null
//   - Allow-listed prefix (/api/, /assets/, /build/)            → null
//   - Otherwise                                      → "/drills/live"

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  liveDrillRedirectTarget,
  userIsAdmin,
  type LiveRedirectInput,
} from "./live-redirect.server";

// Minimal user shape — `liveDrillRedirectTarget` only reads { id, role }.
type TestUser = NonNullable<LiveRedirectInput["user"]>;
const NON_ADMIN: TestUser = { id: "u1", role: "USER" } as TestUser;
const ADMIN: TestUser = { id: "u2", role: "ADMIN" } as TestUser;

function call(overrides: Partial<LiveRedirectInput>): string | null {
  return liveDrillRedirectTarget({
    user: NON_ADMIN,
    pathname: "/",
    hasActiveDrill: true,
    isAdmin: false,
    ...overrides,
  });
}

describe("liveDrillRedirectTarget", () => {
  it("signed-out user + active drill → null (root loader handles auth)", () => {
    assert.equal(
      call({ user: null, isAdmin: false, hasActiveDrill: true, pathname: "/" }),
      null,
    );
  });

  it("admin + active drill on /admin/drills → null (admin keeps admin access)", () => {
    assert.equal(
      call({ user: ADMIN, isAdmin: true, pathname: "/admin/drills" }),
      null,
    );
  });

  it("admin + active drill on any tenant page → null", () => {
    assert.equal(
      call({ user: ADMIN, isAdmin: true, pathname: "/homerooms" }),
      null,
    );
  });

  it("non-admin + active drill on / → /drills/live", () => {
    assert.equal(call({ pathname: "/" }), "/drills/live");
  });

  it("non-admin + active drill on arbitrary tenant page → /drills/live", () => {
    assert.equal(call({ pathname: "/homerooms" }), "/drills/live");
    assert.equal(call({ pathname: "/admin/drills" }), "/drills/live");
  });

  it("any user + active drill on /drills/live → null (already there)", () => {
    assert.equal(call({ pathname: "/drills/live" }), null);
    assert.equal(
      call({ user: ADMIN, isAdmin: true, pathname: "/drills/live" }),
      null,
    );
  });

  it("any user + active drill on /api/* → null (API is allowed)", () => {
    assert.equal(call({ pathname: "/api/foo" }), null);
    assert.equal(call({ pathname: "/api/auth/session" }), null);
    assert.equal(call({ pathname: "/api/healthz" }), null);
  });

  it("any user + active drill on /assets/* or /build/* → null (static)", () => {
    assert.equal(call({ pathname: "/assets/logo.svg" }), null);
    assert.equal(call({ pathname: "/build/index.js" }), null);
  });

  it("any user + active drill on /logout or /set-password → null (auth flows)", () => {
    assert.equal(call({ pathname: "/logout" }), null);
    assert.equal(call({ pathname: "/set-password" }), null);
  });

  it("non-admin with NO active drill → null no matter the path", () => {
    assert.equal(
      call({ hasActiveDrill: false, pathname: "/" }),
      null,
    );
    assert.equal(
      call({ hasActiveDrill: false, pathname: "/homerooms" }),
      null,
    );
  });

  it("empty pathname is treated as '/' (still redirected for non-admins)", () => {
    assert.equal(call({ pathname: "" }), "/drills/live");
  });
});

describe("userIsAdmin", () => {
  it("returns false for null / undefined", () => {
    assert.equal(userIsAdmin(null), false);
    assert.equal(userIsAdmin(undefined), false);
  });

  it("returns true for ADMIN", () => {
    assert.equal(userIsAdmin({ role: "ADMIN" } as TestUser), true);
  });

  it("returns true for CONTROLLER", () => {
    assert.equal(userIsAdmin({ role: "CONTROLLER" } as TestUser), true);
  });

  it("returns false for non-admin roles", () => {
    assert.equal(userIsAdmin({ role: "USER" } as TestUser), false);
    assert.equal(userIsAdmin({ role: "VIEWER" } as TestUser), false);
  });
});
