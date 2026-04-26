import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarketingHost,
  marketingOriginFromRequest,
  isPlatformAdmin,
  resolveTenantSlugFromHost,
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

test("resolveTenantSlugFromHost: production host with PUBLIC_ROOT_DOMAIN", () => {
  const c = ctx({ PUBLIC_ROOT_DOMAIN: "example.com" });
  assert.equal(
    resolveTenantSlugFromHost(new Request("https://school.example.com/"), c),
    "school",
  );
  assert.equal(
    resolveTenantSlugFromHost(new Request("https://example.com/"), c),
    null,
  );
  assert.equal(
    resolveTenantSlugFromHost(new Request("https://www.example.com/"), c),
    null,
  );
});

test("resolveTenantSlugFromHost: dev *.localhost still resolves when PUBLIC_ROOT_DOMAIN is set", () => {
  // Wrangler dev sets PUBLIC_ROOT_DOMAIN from wrangler.jsonc top-level
  // vars, so the e2e fixture's `{slug}.localhost:PORT` host must still
  // be detected as a tenant — otherwise admin flows are routed as
  // anonymous and bounce to /login. Regression coverage for the CI run
  // that broke admin-roster + viewer-pin specs.
  const c = ctx({ PUBLIC_ROOT_DOMAIN: "pickuproster.com" });
  assert.equal(
    resolveTenantSlugFromHost(
      new Request("http://e2e-abc123.localhost:8787/admin"),
      c,
    ),
    "e2e-abc123",
  );
  // Apex localhost is not a tenant — it's the marketing host in dev.
  assert.equal(
    resolveTenantSlugFromHost(new Request("http://localhost:8787/"), c),
    null,
  );
});

test("resolveTenantSlugFromHost: no PUBLIC_ROOT_DOMAIN falls back to dev + legacy paths", () => {
  const c = ctx({});
  assert.equal(
    resolveTenantSlugFromHost(new Request("http://tome.localhost:8787/"), c),
    "tome",
  );
  assert.equal(
    resolveTenantSlugFromHost(new Request("http://tome.example.com/"), c),
    "tome",
  );
  assert.equal(
    resolveTenantSlugFromHost(new Request("http://localhost:8787/"), c),
    null,
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
