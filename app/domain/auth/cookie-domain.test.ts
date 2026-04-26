/**
 * Tests for the cross-subdomain cookie gate. Production and staging both
 * deploy at a real DNS apex now (`pickuproster.com` and
 * `staging.pickuproster.com`), so the gate is no longer environment-keyed —
 * it just needs PUBLIC_ROOT_DOMAIN to be a real apex (not localhost) and
 * the kill-switch env var to be off.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sharedSessionCookieDomain } from "./cookie-domain.server";

function ctx(env: Record<string, string | undefined>) {
  return { cloudflare: { env } };
}

test("sharedSessionCookieDomain returns root for production apex", () => {
  assert.equal(
    sharedSessionCookieDomain(
      ctx({ ENVIRONMENT: "production", PUBLIC_ROOT_DOMAIN: "pickuproster.com" }),
    ),
    "pickuproster.com",
  );
});

test("sharedSessionCookieDomain returns root for staging apex (no env gate)", () => {
  assert.equal(
    sharedSessionCookieDomain(
      ctx({
        ENVIRONMENT: "staging",
        PUBLIC_ROOT_DOMAIN: "staging.pickuproster.com",
      }),
    ),
    "staging.pickuproster.com",
  );
});

test("sharedSessionCookieDomain returns null for empty PUBLIC_ROOT_DOMAIN", () => {
  assert.equal(
    sharedSessionCookieDomain(ctx({ ENVIRONMENT: "production" })),
    null,
  );
});

test("sharedSessionCookieDomain returns null for localhost-style roots", () => {
  for (const root of ["localhost", "tome.localhost", "127.0.0.1", "foo.local"]) {
    assert.equal(
      sharedSessionCookieDomain(
        ctx({ ENVIRONMENT: "development", PUBLIC_ROOT_DOMAIN: root }),
      ),
      null,
      `expected null for ${root}`,
    );
  }
});

test("DISABLE_CROSS_SUBDOMAIN_COOKIES kill switch forces host-only", () => {
  for (const flag of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(
      sharedSessionCookieDomain(
        ctx({
          ENVIRONMENT: "production",
          PUBLIC_ROOT_DOMAIN: "pickuproster.com",
          DISABLE_CROSS_SUBDOMAIN_COOKIES: flag,
        }),
      ),
      null,
      `expected null when kill switch = ${flag}`,
    );
  }
});

test("DISABLE_CROSS_SUBDOMAIN_COOKIES with falsy values does not disable", () => {
  for (const flag of ["", "0", "false", "no"]) {
    assert.equal(
      sharedSessionCookieDomain(
        ctx({
          ENVIRONMENT: "production",
          PUBLIC_ROOT_DOMAIN: "pickuproster.com",
          DISABLE_CROSS_SUBDOMAIN_COOKIES: flag,
        }),
      ),
      "pickuproster.com",
      `expected pickuproster.com when kill switch = "${flag}"`,
    );
  }
});
