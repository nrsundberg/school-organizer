import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertNotAlreadyImpersonating,
  resolveActorIds,
  IMPERSONATION_NESTED_CODE,
} from "./impersonate-gate.server";

describe("assertNotAlreadyImpersonating", () => {
  it("returns null when current session is not an impersonation session", () => {
    assert.equal(assertNotAlreadyImpersonating(null), null);
    assert.equal(assertNotAlreadyImpersonating(undefined), null);
  });

  it("returns a 403 Response with IMPERSONATION_NESTED code when already impersonating", () => {
    const res = assertNotAlreadyImpersonating("u_admin_alice");
    assert.ok(res instanceof Response);
    assert.equal(res!.status, 403);
  });

  it("response body includes the IMPERSONATION_NESTED code", async () => {
    const res = assertNotAlreadyImpersonating("u_admin_alice")!;
    const body = (await res.json()) as { code: string; message: string };
    assert.equal(body.code, IMPERSONATION_NESTED_CODE);
    assert.equal(typeof body.message, "string");
    assert.ok(body.message.length > 0);
  });
});

describe("resolveActorIds", () => {
  it("returns null actor when no session user", () => {
    assert.deepEqual(resolveActorIds(null, null), {
      actorUserId: null,
      onBehalfOfUserId: null,
    });
  });

  it("returns the user as actor when not impersonating", () => {
    assert.deepEqual(resolveActorIds("u_bob", null), {
      actorUserId: "u_bob",
      onBehalfOfUserId: null,
    });
    assert.deepEqual(resolveActorIds("u_bob", undefined), {
      actorUserId: "u_bob",
      onBehalfOfUserId: null,
    });
  });

  it("returns admin as actor and effective user as onBehalfOf when impersonating", () => {
    assert.deepEqual(resolveActorIds("u_bob", "u_alice"), {
      actorUserId: "u_alice",
      onBehalfOfUserId: "u_bob",
    });
  });
});
