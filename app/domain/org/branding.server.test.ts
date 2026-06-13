import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCustomDomain, CUSTOM_DOMAIN_RE } from "./branding.server";

describe("validateCustomDomain", () => {
  it("accepts an empty string (clears the domain)", () => {
    assert.equal(validateCustomDomain(""), null);
  });

  it("accepts a simple subdomain", () => {
    assert.equal(validateCustomDomain("pickup.myschool.org"), null);
  });

  it("accepts a two-label domain", () => {
    assert.equal(validateCustomDomain("myschool.com"), null);
  });

  it("accepts hyphens within labels", () => {
    assert.equal(validateCustomDomain("my-school.example.org"), null);
  });

  it("accepts multiple subdomains", () => {
    assert.equal(validateCustomDomain("a.b.c.example.co"), null);
  });

  it("rejects a bare hostname (no dot)", () => {
    assert.notEqual(validateCustomDomain("localhost"), null);
  });

  it("rejects a label starting with a hyphen", () => {
    assert.notEqual(validateCustomDomain("-bad.example.com"), null);
  });

  it("rejects a label ending with a hyphen", () => {
    assert.notEqual(validateCustomDomain("bad-.example.com"), null);
  });

  it("rejects uppercase characters", () => {
    assert.notEqual(validateCustomDomain("Pickup.MySchool.org"), null);
  });

  it("rejects a domain with a TLD shorter than two characters", () => {
    assert.notEqual(validateCustomDomain("myschool.c"), null);
  });

  it("rejects domains with protocol prefix", () => {
    assert.notEqual(validateCustomDomain("https://pickup.myschool.org"), null);
  });

  it("rejects domains with trailing dot", () => {
    assert.notEqual(validateCustomDomain("pickup.myschool.org."), null);
  });
});

describe("CUSTOM_DOMAIN_RE", () => {
  it("matches a canonical domain", () => {
    assert.ok(CUSTOM_DOMAIN_RE.test("pickup.myschool.org"));
  });

  it("does not match an empty string", () => {
    assert.ok(!CUSTOM_DOMAIN_RE.test(""));
  });
});
