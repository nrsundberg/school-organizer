import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findActiveSampleIndex,
  groupAttachmentsByRun,
  type SocketAttachment,
} from "./presence-sample-aggregate";

function att(over: Partial<SocketAttachment>): SocketAttachment {
  return {
    runId: "run_1",
    userId: "u1",
    label: "Alice",
    onBehalfOfUserId: null,
    onBehalfOfLabel: null,
    isGuest: false,
    color: "hsl(0 0% 50%)",
    at: 0,
    ...over,
  };
}

describe("groupAttachmentsByRun", () => {
  it("returns [] when no attachments", () => {
    assert.deepEqual(groupAttachmentsByRun([]), []);
  });

  it("groups authed viewers by runId", () => {
    const out = groupAttachmentsByRun([
      att({ runId: "r1", userId: "u1", label: "Alice" }),
      att({ runId: "r1", userId: "u2", label: "Bob" }),
      att({ runId: "r2", userId: "u3", label: "Carol" }),
    ]);
    assert.equal(out.length, 2);
    const r1 = out.find((s) => s.runId === "r1")!;
    const r2 = out.find((s) => s.runId === "r2")!;
    assert.deepEqual(
      r1.authedViewers.map((v) => v.userId).sort(),
      ["u1", "u2"],
    );
    assert.equal(r1.guestCount, 0);
    assert.deepEqual(
      r2.authedViewers.map((v) => v.userId),
      ["u3"],
    );
    assert.equal(r2.guestCount, 0);
  });

  it("counts guests separately from authed viewers", () => {
    const out = groupAttachmentsByRun([
      att({ runId: "r1", userId: "u1", label: "Alice" }),
      att({ runId: "r1", userId: "g1", label: null, isGuest: true }),
      att({ runId: "r1", userId: "g2", label: null, isGuest: true }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].authedViewers.length, 1);
    assert.equal(out[0].guestCount, 2);
  });

  it("dedupes the same userId across multiple sockets, keeping the most recent attachment", () => {
    const out = groupAttachmentsByRun([
      att({ runId: "r1", userId: "u1", label: "Alice", at: 100, color: "old" }),
      att({ runId: "r1", userId: "u1", label: "Alice", at: 200, color: "new" }),
      att({ runId: "r1", userId: "u1", label: "Alice", at: 150, color: "mid" }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].authedViewers.length, 1);
    assert.equal(out[0].authedViewers[0].color, "new");
  });

  it("emits a snapshot row for guest-only runs", () => {
    const out = groupAttachmentsByRun([
      att({ runId: "r1", userId: "g1", label: null, isGuest: true }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].authedViewers.length, 0);
    assert.equal(out[0].guestCount, 1);
  });

  it("preserves impersonation context for authed viewers", () => {
    const out = groupAttachmentsByRun([
      att({
        runId: "r1",
        userId: "u1",
        label: "Noah Sundberg",
        onBehalfOfUserId: "u2",
        onBehalfOfLabel: "Demo Admin",
      }),
    ]);
    assert.equal(out[0].authedViewers[0].onBehalfOfUserId, "u2");
    assert.equal(out[0].authedViewers[0].onBehalfOfLabel, "Demo Admin");
  });

  it("ignores attachments with empty/missing runId", () => {
    // The runtime guard accepts the loose `unknown`-shaped attachments that
    // can happen if a hibernation-restored socket has a malformed payload;
    // cast through `unknown` so we can simulate that without our test
    // tripping the `runId: string` constraint.
    const malformed = { ...att({ userId: "u2" }), runId: undefined };
    const out = groupAttachmentsByRun([
      att({ runId: "", userId: "u1" }),
      malformed as unknown as SocketAttachment,
      att({ runId: "r1", userId: "u3", label: "Carol" }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].runId, "r1");
  });

  it("returns deterministic ordering (run + userId)", () => {
    const out1 = groupAttachmentsByRun([
      att({ runId: "rB", userId: "u2", label: "Bob" }),
      att({ runId: "rA", userId: "u1", label: "Alice" }),
    ]);
    const out2 = groupAttachmentsByRun([
      att({ runId: "rA", userId: "u1", label: "Alice" }),
      att({ runId: "rB", userId: "u2", label: "Bob" }),
    ]);
    assert.deepEqual(out1, out2);
    assert.deepEqual(
      out1.map((s) => s.runId),
      ["rA", "rB"],
    );
  });
});

describe("findActiveSampleIndex", () => {
  const samples = [
    { occurredAtMs: 0, n: 1 },
    { occurredAtMs: 30_000, n: 2 },
    { occurredAtMs: 60_000, n: 3 },
    { occurredAtMs: 90_000, n: 4 },
  ];

  it("returns -1 for an empty list", () => {
    assert.equal(findActiveSampleIndex([], 1234), -1);
  });

  it("returns -1 when currentTime is before the first sample", () => {
    assert.equal(findActiveSampleIndex(samples, -1), -1);
  });

  it("returns 0 at exactly the first sample's offset", () => {
    assert.equal(findActiveSampleIndex(samples, 0), 0);
  });

  it("returns the last sample <= currentTime", () => {
    assert.equal(findActiveSampleIndex(samples, 15_000), 0);
    assert.equal(findActiveSampleIndex(samples, 30_000), 1);
    assert.equal(findActiveSampleIndex(samples, 30_001), 1);
    assert.equal(findActiveSampleIndex(samples, 75_000), 2);
  });

  it("clamps past the last sample to the last index", () => {
    assert.equal(findActiveSampleIndex(samples, 999_999), samples.length - 1);
  });

  it("agrees with a linear scan for randomized inputs", () => {
    // Build a sorted-ascending list of 50 sample times then probe it with
    // random query points; binary search must agree with linear search.
    const big: { occurredAtMs: number }[] = [];
    let t = 0;
    for (let i = 0; i < 50; i++) {
      t += 1 + Math.floor(Math.random() * 100);
      big.push({ occurredAtMs: t });
    }
    for (let q = -5; q < t + 5; q += 7) {
      const linear = (() => {
        let idx = -1;
        for (let i = 0; i < big.length; i++) {
          if (big[i].occurredAtMs <= q) idx = i;
          else break;
        }
        return idx;
      })();
      assert.equal(
        findActiveSampleIndex(big, q),
        linear,
        `mismatch at q=${q}`,
      );
    }
  });
});
