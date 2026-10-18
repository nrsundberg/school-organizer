import test from "node:test";
import assert from "node:assert/strict";
import { schoolPickupBoardCopy } from "./school-pickup-board-copy";

function flatten(language: string): string {
  const walk = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(walk).join("\n");
    if (value && typeof value === "object") {
      return Object.values(value).map(walk).join("\n");
    }
    return "";
  };
  return walk(schoolPickupBoardCopy(language));
}

test("the pickup board page uses current prices and the 30-day trial", () => {
  for (const language of ["en", "es"]) {
    const text = flatten(language);
    assert.match(text, /\$150/);
    assert.match(text, /\$1,440/);
    assert.match(text, /\$500/);
    assert.match(text, /\$4,800/);
    assert.match(text, /30/);
    assert.doesNotMatch(text, /Tome/i);
    assert.doesNotMatch(text, /\[/);
    assert.doesNotMatch(text, /CONFIRM/);
    assert.doesNotMatch(text, /\$100/);
    assert.doesNotMatch(text, /\$1,200/);
    assert.doesNotMatch(text, /\$6,000/);
  }
});

test("the English H1 names the school pickup board", () => {
  const copy = schoolPickupBoardCopy("en");
  assert.match(copy.h1, /school pickup board/i);
  assert.match(copy.metaTitle, /PickupRoster/);
});
