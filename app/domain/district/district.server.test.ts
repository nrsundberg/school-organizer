import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugifyDistrictName, computeCapState } from "./district.server";

describe("slugifyDistrictName", () => {
  it("lowercases and dashes spaces", () => {
    assert.equal(slugifyDistrictName("Lake County Schools"), "lake-county-schools");
  });
  it("strips disallowed punctuation", () => {
    assert.equal(slugifyDistrictName("St. Paul's Diocese"), "st-pauls-diocese");
  });
  it("collapses multiple dashes", () => {
    assert.equal(slugifyDistrictName("a -- b"), "a-b");
  });
  it("trims leading/trailing dashes", () => {
    assert.equal(slugifyDistrictName(" - hello - "), "hello");
  });
  it("returns empty string for input with no slug-safe characters", () => {
    assert.equal(slugifyDistrictName("!!!"), "");
  });
});

describe("computeCapState", () => {
  it("returns 'within' when count < cap", () => {
    assert.deepEqual(computeCapState(2, 3), {
      state: "within",
      count: 2,
      cap: 3,
      over: 0,
    });
  });
  it("returns 'at' when count == cap", () => {
    assert.deepEqual(computeCapState(3, 3), {
      state: "at",
      count: 3,
      cap: 3,
      over: 0,
    });
  });
  it("returns 'over' with delta when count > cap", () => {
    assert.deepEqual(computeCapState(5, 3), {
      state: "over",
      count: 5,
      cap: 3,
      over: 2,
    });
  });
});
