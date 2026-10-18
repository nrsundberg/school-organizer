import test from "node:test";
import assert from "node:assert/strict";
import { boardFrameClassName, boardHeaderLinkProps } from "./board-frame";

test("the live board pins the header instead of scrolling it out of view", () => {
  assert.match(boardFrameClassName, /flex-col/);
  assert.match(boardFrameClassName, /overflow-hidden/);
  assert.doesNotMatch(boardFrameClassName, /overflow-y-auto/);
});

test("Admin and Profile on the board navigate with a full document load", () => {
  assert.equal(boardHeaderLinkProps(true).reloadDocument, true);
  assert.equal("reloadDocument" in boardHeaderLinkProps(false), false);
});
