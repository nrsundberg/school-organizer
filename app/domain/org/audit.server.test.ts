import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_AUDIT_ACTIONS,
  diffFields,
  isDiffEmpty,
  auditOrgAction,
} from "./audit.server";
import { getPrisma } from "~/db.server";
import {
  orgContext,
  userContext,
  impersonatedByContext,
} from "~/domain/utils/global-context.server";

describe("ORG_AUDIT_ACTIONS", () => {
  it("includes the branding action the feature was requested for", () => {
    assert.ok(
      (ORG_AUDIT_ACTIONS as readonly string[]).includes("branding.update"),
    );
  });
});

describe("diffFields", () => {
  it("keeps only the keys whose value changed", () => {
    const diff = diffFields(
      { brandColor: "#AAA", logo: "old.png", name: "Same" },
      { brandColor: "#BBB", logo: "old.png", name: "Same" },
      ["brandColor", "logo", "name"],
    );
    assert.deepEqual(diff, {
      before: { brandColor: "#AAA" },
      after: { brandColor: "#BBB" },
    });
  });

  it("returns an empty diff when nothing changed", () => {
    const diff = diffFields({ a: 1 }, { a: 1 }, ["a"]);
    assert.ok(isDiffEmpty(diff));
  });

  it("treats undefined and null as the same unset value", () => {
    const diff = diffFields({ a: undefined }, { a: null }, ["a"]);
    assert.ok(isDiffEmpty(diff), "unset → unset is not a change");
  });

  it("records a transition between unset and a value", () => {
    const diff = diffFields({}, { logo: "new.png" }, ["logo"]);
    assert.deepEqual(diff, {
      before: { logo: null },
      after: { logo: "new.png" },
    });
  });
});

// --- auditOrgAction: a fake context that satisfies getOrgFromContext /
// getActorIdsFromContext and seeds the per-request Prisma client. ---

type Captured = { create: any[] };

function makeHarness(opts: {
  user: { id: string } | null;
  impersonatedBy?: string | null;
  actorEmail?: string | null;
}) {
  const captured: Captured = { create: [] };
  const fakeClient = {
    user: {
      findUnique: async () => ({ email: opts.actorEmail ?? null }),
    },
    orgAuditLog: {
      create: async (args: any) => {
        captured.create.push(args.data);
        return args.data;
      },
    },
  };
  const d1 = {};
  const map = new Map<unknown, unknown>([
    [orgContext, { id: "org_test" }],
    [userContext, opts.user],
    [impersonatedByContext, opts.impersonatedBy ?? null],
  ]);
  const context = {
    get: (key: unknown) => map.get(key),
    cloudflare: { env: { D1_DATABASE: d1 } },
  };
  // Seed the WeakMap-keyed per-request client so the module's bare
  // getPrisma(context) returns our fake.
  getPrisma(context, undefined, () => fakeClient as never);
  return { context, captured };
}

describe("auditOrgAction", () => {
  it("writes one row with the actor pair, email snapshot, and diff payload", async () => {
    const { context, captured } = makeHarness({
      user: { id: "user_admin" },
      actorEmail: "admin@example.com",
    });
    const request = new Request("https://tome.pickuproster.com/admin/branding", {
      headers: {
        "user-agent": "TestAgent/1.0",
        "CF-Connecting-IP": "203.0.113.7",
      },
    });

    // No cfCtx on the fake context → returns the promise for a deterministic await.
    await auditOrgAction(context, request, {
      action: "branding.update",
      targetType: "org",
      targetId: "org_test",
      before: { brandColor: "#AAA" },
      after: { brandColor: "#BBB" },
      keys: ["brandColor"],
    });

    assert.equal(captured.create.length, 1);
    const row = captured.create[0];
    assert.equal(row.action, "branding.update");
    assert.equal(row.orgId, "org_test");
    assert.equal(row.actorUserId, "user_admin");
    assert.equal(row.onBehalfOfUserId, null);
    assert.equal(row.actorEmail, "admin@example.com");
    assert.equal(row.ipAddress, "203.0.113.7");
    assert.equal(row.userAgent, "TestAgent/1.0");
    assert.equal(row.targetType, "org");
    assert.equal(row.targetId, "org_test");
    assert.deepEqual(row.payload, {
      before: { brandColor: "#AAA" },
      after: { brandColor: "#BBB" },
    });
  });

  it("writes nothing when the diff is empty (no-op submit)", async () => {
    const { context, captured } = makeHarness({ user: { id: "user_admin" } });
    const request = new Request("https://tome.pickuproster.com/admin/branding");

    await auditOrgAction(context, request, {
      action: "branding.update",
      before: { brandColor: "#AAA" },
      after: { brandColor: "#AAA" },
      keys: ["brandColor"],
    });

    assert.equal(captured.create.length, 0);
  });

  it("records the impersonation pair (admin acting on behalf of a user)", async () => {
    // better-auth model: session user is the impersonated user; impersonatedBy
    // is the admin. The audit pair flips them.
    const { context, captured } = makeHarness({
      user: { id: "user_impersonated" },
      impersonatedBy: "user_admin",
      actorEmail: "admin@example.com",
    });
    const request = new Request("https://tome.pickuproster.com/admin/students/1");

    await auditOrgAction(context, request, {
      action: "student.update",
      targetType: "student",
      targetId: "1",
      payload: { note: "changed homeroom" },
    });

    assert.equal(captured.create.length, 1);
    const row = captured.create[0];
    assert.equal(row.actorUserId, "user_admin", "the human who clicked");
    assert.equal(row.onBehalfOfUserId, "user_impersonated");
  });
});
