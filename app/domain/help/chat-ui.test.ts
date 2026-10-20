import test from "node:test";
import assert from "node:assert/strict";
import { helpErrorRef, restoreFailedChatSend, type HelpTurn } from "./chat-ui";

test("a failed send restores the draft and does not leave two user turns", () => {
  const prev: HelpTurn[] = [
    { role: "user", content: "How long is the free trial?" },
    { role: "assistant", content: "30 days." },
  ];
  const draft = "What does Car Line cost?";
  const optimistic: HelpTurn[] = [...prev, { role: "user", content: draft }];
  const restored = restoreFailedChatSend(prev, draft);

  const ifLeftInPlace: HelpTurn[] = [...optimistic, { role: "user", content: restored.draft }];
  assert.deepEqual(
    ifLeftInPlace.map((turn) => turn.role),
    ["user", "assistant", "user", "user"],
  );

  const retried: HelpTurn[] = [...restored.turns, { role: "user", content: restored.draft }];
  assert.deepEqual(
    retried.map((turn) => turn.role),
    ["user", "assistant", "user"],
  );
  assert.equal(restored.draft, draft);
  assert.notEqual(restored.turns, prev);
});

test("help error ref shows only a safe upstream code", () => {
  assert.equal(helpErrorRef("upstream_401", "authentication_error"), "(ref: upstream_401 authentication_error)");
  assert.equal(helpErrorRef("upstream_empty", undefined), "(ref: upstream_empty)");
  assert.equal(helpErrorRef("unconfigured", undefined), null);
  assert.equal(helpErrorRef("upstream_401", "sk-ant-api03-secret leaked"), "(ref: upstream_401)");
  assert.equal(helpErrorRef("upstream_401", "sk-ant-api03-secret"), "(ref: upstream_401)");
  assert.equal(helpErrorRef(undefined, "authentication_error"), null);
});
