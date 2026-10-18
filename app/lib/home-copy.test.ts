import test from "node:test";
import assert from "node:assert/strict";
import { homeCopy, homeCopyWordCount } from "./home-copy";

function flatten(language: string): string {
  const walk = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(walk).join("\n");
    if (value && typeof value === "object") {
      return Object.values(value).map(walk).join("\n");
    }
    return "";
  };
  return walk(homeCopy(language));
}

test("English home copy stays in the long-form range", () => {
  const words = homeCopyWordCount("en");
  assert.ok(words >= 700 && words <= 1000, `expected 700-1000 words, got ${words}`);
});

test("home copy uses current prices, the trial, and the allowed Maryland fact", () => {
  for (const language of ["en", "es"]) {
    const text = flatten(language);
    assert.match(text, /\$150/);
    assert.match(text, /\$1,440/);
    assert.match(text, /\$500/);
    assert.match(text, /\$4,800/);
    assert.match(text, /20/);
    assert.match(text, /30/);
    assert.match(text, /Maryland/);
    assert.doesNotMatch(text, /Tome/i);
    assert.doesNotMatch(text, /WebSocket/i);
    assert.doesNotMatch(text, /\[/);
    assert.doesNotMatch(text, /testimonial/i);
  }
});

test("the English H1 names the school pickup board and the car line", () => {
  const copy = homeCopy("en");
  assert.match(copy.h1, /school pickup board/i);
  assert.match(copy.h1, /car line/i);
  assert.equal(copy.bookDemo, "Book a demo");
  assert.equal(copy.startTrial, "Start free trial");
});

test("home reading links point at the chosen guides and posts", () => {
  const hrefs = homeCopy("en").reads.map((item) => item.href);
  assert.deepEqual(hrefs, homeCopy("es").reads.map((item) => item.href));
  assert.deepEqual(hrefs, [
    "/guides/configuring-pickup-zones-and-lane-assignments",
    "/guides/importing-student-rosters-from-sis",
    "/guides/setting-up-your-first-drill-template",
    "/blog/diagnose-car-line-wait-times-before-the-first-bell",
    "/blog/from-clipboards-to-carlines-digital-transition-guide",
  ]);
});
