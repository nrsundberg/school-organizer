import test from "node:test";
import assert from "node:assert/strict";
import { slugifyOrgName } from "./onboarding.server";

test("slugifies organization names", () => {
  assert.equal(slugifyOrgName("  Acme School District  "), "acme-school-district");
  assert.equal(slugifyOrgName("Tome!@#$%^&*()"), "tome");
});

test("caps slug length", () => {
  const source = "a".repeat(80);
  const slug = slugifyOrgName(source);
  assert.equal(slug.length, 50);
});

