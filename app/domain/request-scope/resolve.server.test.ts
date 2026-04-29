import test from "node:test";
import assert from "node:assert/strict";
import type { Org, User } from "~/db";
import {
  resolveRequestScope,
  type ResolveDeps,
  type SessionFacts,
} from "./resolve.server";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function buildOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: "org_1",
    name: "Test Org",
    slug: "test",
    customDomain: null,
    status: "ACTIVE",
    isComped: false,
    compedUntil: null,
    districtId: null,
    // Fields below are not consulted by the resolver but the type demands them.
    brandColor: null,
    brandAccentColor: null,
    primaryColor: null,
    secondaryColor: null,
    logoUrl: null,
    logoObjectKey: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingPlan: "FREE",
    subscriptionStatus: null,
    trialStartedAt: null,
    trialQualifyingPickupDays: 0,
    trialEndsAt: null,
    usageGraceStartedAt: null,
    pastDueSinceAt: null,
    billingNote: null,
    passwordResetEnabled: true,
    defaultLocale: "en",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Org;
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user_1",
    email: "u@example.com",
    emailVerified: true,
    name: "Test User",
    phone: null,
    image: null,
    role: "VIEWER",
    mustChangePassword: false,
    banned: false,
    banReason: null,
    banExpires: null,
    controllerViewPreference: null,
    locale: "en",
    orgId: "org_1",
    districtId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

/** Build a deps shim around an in-memory org table. */
function makeDeps(opts: {
  orgs?: Org[];
  districts?: Array<{
    id: string;
    status: string;
    compedUntil: Date | null;
    isComped: boolean;
  }>;
  session?: SessionFacts;
  hasViewerAccess?: boolean;
  marketing?: boolean;
  platformAdmin?: boolean;
  tenantSlugFromHost?: string | null;
} = {}): ResolveDeps {
  const orgs = opts.orgs ?? [];
  const districts = opts.districts ?? [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o]));
  const orgByCustomDomain = new Map(
    orgs.filter((o) => o.customDomain).map((o) => [o.customDomain!, o]),
  );
  const districtById = new Map(districts.map((d) => [d.id, d]));

  return {
    db: {
      org: {
        findFirst: async (args: any) => {
          if (args?.where?.customDomain) {
            return orgByCustomDomain.get(args.where.customDomain) ?? null;
          }
          // orderBy createdAt asc fallback
          return orgs[0] ?? null;
        },
        findUnique: async (args: any) => {
          if (args?.where?.id) return orgById.get(args.where.id) ?? null;
          if (args?.where?.slug) return orgBySlug.get(args.where.slug) ?? null;
          return null;
        },
      },
      district: {
        findUnique: async (args: any) => {
          if (args?.where?.id) return districtById.get(args.where.id) ?? null;
          return null;
        },
      },
    } as unknown as ResolveDeps["db"],
    loadSession: async () =>
      opts.session ?? { user: null, impersonatedOrgId: null, impersonatedBy: null },
    hasViewerAccess: async () => opts.hasViewerAccess ?? false,
    isMarketingHost: () => opts.marketing ?? false,
    isPlatformAdmin: () => opts.platformAdmin ?? false,
    marketingOrigin: () => "https://example.com",
    resolveTenantSlug: () => opts.tenantSlugFromHost ?? null,
    tenantBoardUrl: (_req, slug) => `https://${slug}.example.com`,
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
}

function tenantRequest(
  pathname: string,
  slug = "test",
  search = "",
): Request {
  return new Request(`https://${slug}.example.com${pathname}${search}`);
}

function marketingRequest(pathname: string): Request {
  return new Request(`https://example.com${pathname}`);
}

/** Run the resolver and capture either the result or the thrown Response. */
async function run(
  request: Request,
  deps: ResolveDeps,
): Promise<
  | { kind: "ok"; scope: Awaited<ReturnType<typeof resolveRequestScope>> }
  | { kind: "redirect"; status: number; location: string }
> {
  try {
    const scope = await resolveRequestScope(request, {}, deps);
    return { kind: "ok", scope };
  } catch (e) {
    if (e instanceof Response) {
      return {
        kind: "redirect",
        status: e.status,
        location: e.headers.get("Location") ?? "",
      };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("anonymous request to a tenant subdomain without a viewer cookie redirects to /viewer-access", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const result = await run(
    tenantRequest("/board"),
    makeDeps({ orgs: [org], tenantSlugFromHost: "test" }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.status, 302);
  assert.equal(result.location, "/viewer-access?next=%2Fboard");
});

test("anonymous request with a valid viewer cookie passes through", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const result = await run(
    tenantRequest("/board"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      hasViewerAccess: true,
    }),
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.scope.user, null);
  assert.equal(result.scope.org?.id, "org_1");
});

test("platform admin landing on a tenant subdomain is bounced to /platform", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({ orgId: null, role: "ADMIN" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
      platformAdmin: true,
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "https://example.com/platform");
});

test("district admin (no orgId) landing on a tenant subdomain is bounced to /district", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({
    orgId: null,
    districtId: "dist_1",
    role: "ADMIN",
  });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "https://example.com/district");
});

test("regular user on the wrong tenant is redirected to their home org", async () => {
  const wrongOrg = buildOrg({ id: "org_wrong", slug: "wrong" });
  const homeOrg = buildOrg({ id: "org_home", slug: "home" });
  const user = buildUser({ orgId: "org_home", role: "VIEWER" });
  const result = await run(
    tenantRequest("/admin/dashboard", "wrong"),
    makeDeps({
      orgs: [wrongOrg, homeOrg],
      tenantSlugFromHost: "wrong",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "https://home.example.com");
});

test("authed user with no orgId on a tenant they don't belong to is sent to /signup", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({ orgId: null, role: "VIEWER" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "https://example.com/signup");
});

test("impersonation overlay sets effective org and surfaces realOrg", async () => {
  const homeOrg = buildOrg({ id: "org_home", slug: "home" });
  const impOrg = buildOrg({ id: "org_imp", slug: "imp" });
  const user = buildUser({
    id: "admin_1",
    orgId: "org_home",
    role: "ADMIN",
  });
  const result = await run(
    tenantRequest("/admin/dashboard", "imp"),
    makeDeps({
      orgs: [homeOrg, impOrg],
      tenantSlugFromHost: "imp",
      session: {
        user,
        impersonatedOrgId: "org_imp",
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.scope.org?.id, "org_imp");
  assert.equal(result.scope.realOrg?.id, "org_home");
  assert.equal(result.scope.impersonation.active, true);
  assert.equal(result.scope.impersonation.orgId, "org_imp");
});

test("impersonation into the user's own org leaves realOrg null", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({ orgId: "org_1", role: "ADMIN" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: "org_1",
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.scope.org?.id, "org_1");
  assert.equal(result.scope.realOrg, null);
});

test("mustChangePassword fires before console redirects", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  // A platform admin who must also change password should be sent to
  // /set-password, not /platform — the password gate runs first.
  const user = buildUser({
    orgId: null,
    role: "ADMIN",
    mustChangePassword: true,
  });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
      platformAdmin: true,
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "/set-password");
});

test("mustChangePassword is suppressed on /set-password itself", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({ orgId: "org_1", mustChangePassword: true });
  const result = await run(
    tenantRequest("/set-password"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "ok");
});

test("billing gate sends suspended orgs to /billing-required", async () => {
  const org = buildOrg({
    id: "org_1",
    slug: "test",
    status: "SUSPENDED",
    compedUntil: null,
    isComped: false,
  });
  const user = buildUser({ orgId: "org_1" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "/billing-required");
});

test("billing-exempt paths (e.g. /billing-required, /api/onboarding) skip the gate even on a suspended org", async () => {
  const org = buildOrg({
    id: "org_1",
    slug: "test",
    status: "SUSPENDED",
  });
  const user = buildUser({ orgId: "org_1" });
  for (const path of ["/billing-required", "/api/onboarding"]) {
    const result = await run(
      tenantRequest(path),
      makeDeps({
        orgs: [org],
        tenantSlugFromHost: "test",
        session: {
          user,
          impersonatedOrgId: null,
          impersonatedBy: null,
        },
      }),
    );
    assert.equal(result.kind, "ok", `expected pass-through for ${path}`);
  }
});

test("district-attached org with missing district row is denied", async () => {
  const org = buildOrg({
    id: "org_1",
    slug: "test",
    districtId: "dist_missing",
  });
  const user = buildUser({ orgId: "org_1" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      // No districts provided → findUnique returns null.
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.location, "/billing-required");
});

test("on the marketing host org and realOrg are null", async () => {
  const result = await run(
    marketingRequest("/pricing"),
    makeDeps({ marketing: true }),
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.scope.org, null);
  assert.equal(result.scope.realOrg, null);
});

test("anonymous request to /platform redirects to /login (not viewer-access)", async () => {
  const result = await run(
    tenantRequest("/platform/orgs"),
    makeDeps({ tenantSlugFromHost: "test", orgs: [buildOrg()] }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.match(result.location, /^\/login\?next=/);
});

test("anonymous request when no org can be resolved redirects to /login", async () => {
  const result = await run(
    tenantRequest("/board", "unknown"),
    makeDeps({
      orgs: [],
      tenantSlugFromHost: "unknown",
    }),
  );
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.match(result.location, /^\/login\?next=/);
});

test("actor pair is set from session user when no impersonation", async () => {
  const org = buildOrg({ id: "org_1", slug: "test" });
  const user = buildUser({ id: "user_xyz", orgId: "org_1" });
  const result = await run(
    tenantRequest("/admin/dashboard"),
    makeDeps({
      orgs: [org],
      tenantSlugFromHost: "test",
      session: {
        user,
        impersonatedOrgId: null,
        impersonatedBy: null,
      },
    }),
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.scope.actor.actorUserId, "user_xyz");
  assert.equal(result.scope.actor.onBehalfOfUserId, null);
});
