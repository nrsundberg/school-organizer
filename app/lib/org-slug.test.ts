import test from "node:test";
import assert from "node:assert/strict";
import {
  schoolBoardHostname,
  slugifyOrgName,
  suggestOrgSlugsFromName,
  tenantBoardUrlFromRequest,
} from "./org-slug";

test("slugifies organization names", () => {
  assert.equal(slugifyOrgName("  Acme School District  "), "acme-school-district");
  assert.equal(slugifyOrgName("Tome!@#$%^&*()"), "tome");
});

test("caps slug length", () => {
  const source = "a".repeat(80);
  const slug = slugifyOrgName(source);
  assert.equal(slug.length, 50);
});

test("suggestOrgSlugsFromName dedupes and orders", () => {
  const s = suggestOrgSlugsFromName("Maple Elementary");
  assert.ok(s.includes("maple-elementary"));
  assert.ok(s.length >= 1);
});

test("suggestOrgSlugsFromName includes initials first for high school names", () => {
  const s = suggestOrgSlugsFromName("Brainerd High School");
  assert.equal(s[0], "bhs");
  assert.ok(s.includes("brainerd-high-school"));
});

test("suggestOrgSlugsFromName strips leading article for initials", () => {
  const s = suggestOrgSlugsFromName("The Brainerd High School");
  assert.equal(s[0], "bhs");
});

test("suggestOrgSlugsFromName puts initials before full slug for two-word names", () => {
  const s = suggestOrgSlugsFromName("Maple Elementary");
  assert.equal(s[0], "me");
  assert.equal(s[1], "maple-elementary");
});

test("suggestOrgSlugsFromName omits one-letter initials", () => {
  const s = suggestOrgSlugsFromName("Lincoln");
  assert.equal(s[0], "lincoln");
  assert.ok(!s.includes("l"));
});

test("schoolBoardHostname", () => {
  assert.equal(schoolBoardHostname("pickuproster.com", "acme"), "acme.pickuproster.com");
  assert.equal(schoolBoardHostname("www.pickuproster.com", "acme"), "acme.pickuproster.com");
  assert.equal(schoolBoardHostname("localhost", "tome"), "tome.localhost");
});

test("tenantBoardUrlFromRequest preserves port on localhost", () => {
  const url = tenantBoardUrlFromRequest(
    new Request("http://localhost:5173/signup"),
    "acme",
  );
  assert.equal(url, "http://acme.localhost:5173/");
});

test("tenantBoardUrlFromRequest apex marketing host", () => {
  const url = tenantBoardUrlFromRequest(
    new Request("https://pickuproster.com/signup"),
    "maple",
  );
  assert.equal(url, "https://maple.pickuproster.com/");
});
