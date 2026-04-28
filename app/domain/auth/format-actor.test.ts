import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatActorLabel } from "./format-actor";

describe("formatActorLabel", () => {
  it("returns just the actor when no impersonator", () => {
    assert.equal(
      formatActorLabel("Alice Admin", null, "(no actor)"),
      "Alice Admin",
    );
  });

  it("composes 'Real as Impersonated' when both are present", () => {
    assert.equal(
      formatActorLabel("Alice Admin", "Bob Parent", "(no actor)"),
      "Alice Admin as Bob Parent",
    );
  });

  it("falls back to the impersonated label when actor is blank", () => {
    assert.equal(formatActorLabel(null, "Bob Parent", "—"), "Bob Parent");
    assert.equal(formatActorLabel("", "Bob Parent", "—"), "Bob Parent");
    assert.equal(formatActorLabel("   ", "Bob Parent", "—"), "Bob Parent");
  });

  it("returns the fallback when both sides are blank", () => {
    assert.equal(formatActorLabel(null, null, "(no actor)"), "(no actor)");
    assert.equal(formatActorLabel("", "", "(no actor)"), "(no actor)");
    assert.equal(formatActorLabel("  ", null, "—"), "—");
  });

  it("trims whitespace before composition", () => {
    assert.equal(
      formatActorLabel("  Alice Admin  ", "  Bob Parent  ", "—"),
      "Alice Admin as Bob Parent",
    );
  });
});
