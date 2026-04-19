import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarketingHost,
  marketingOriginFromRequest,
  isPlatformAdmin,
} from "./host.server";

function ctx(env: Record<string, string | undefined>) {
  return { cloudflare: { env } };
}

test("isMarketingHost: apex and www of PUBLIC_ROOT_DOMAIN", () => {
  const c = ctx({ PUBLIC_ROOT_DOMAIN: "example.com" });
  assert.equal(
    isMarketingHost(new Request("https://example.com/pricing"), c),
    true,
  );
  assert.equal(
    isMarketingHost(new Request("https://www.example.com/"), c),
    true,
  );
  assert.equal(
    isMarketingHost(new Request("https://school.example.com/"), c),
    false,
  );
});

test("marketingOriginFromRequest uses PUBLIC_ROOT_DOMAIN as host", () => {
  const c = ctx({ PUBLIC_ROOT_DOMAIN: "example.com" });
  assert.equal(
    marketingOriginFromRequest(new Request("https://school.example.com/foo"), c),
    "https://example.com",
  );
});

test("isPlatformAdmin: role or allowlist email", () => {
  const c = ctx({ PLATFORM_ADMIN_EMAILS: "ops@school.org" });
  assert.equal(
    isPlatformAdmin(
      { email: "ops@school.org", role: "ADMIN" },
      c,
    ),
    true,
  );
  assert.equal(
    isPlatformAdmin(
      { email: "other@school.org", role: "ADMIN" },
      c,
    ),
    false,
  );
  assert.equal(
    isPlatformAdmin(
      { email: "x@y.z", role: "PLATFORM_ADMIN" },
      c,
    ),
    true,
  );
});
