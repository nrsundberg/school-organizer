import test from "node:test";
import assert from "node:assert/strict";
import { parseDemoForm } from "./demo-form";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  name: "Ada Lovelace",
  role: "Principal",
  school: "Maple Elementary",
  email: "ada@maple.edu",
  phone: "555-0100",
  studentCount: "420",
  message: "We still use radios.",
};

test("parseDemoForm accepts a complete request", () => {
  const result = parseDemoForm(form(valid));
  assert.equal(result.ok, true);
  if (!result.ok || result.honeypot) return;
  assert.equal(result.value.email, "ada@maple.edu");
  assert.equal(result.value.studentCount, "420");
});

test("parseDemoForm allows optional phone, student count, and message", () => {
  const result = parseDemoForm(
    form({ name: "Ada", role: "Principal", school: "Maple", email: "ada@maple.edu" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok || result.honeypot) return;
  assert.equal(result.value.phone, "");
  assert.equal(result.value.message, "");
});

test("parseDemoForm rejects a missing email", () => {
  const result = parseDemoForm(form({ ...valid, email: "not-an-email" }));
  assert.deepEqual(result, { ok: false, error: "email" });
});

test("a filled honeypot is a silent success", () => {
  const result = parseDemoForm(form({ ...valid, website: "https://spam.example" }));
  assert.deepEqual(result, { ok: true, honeypot: true });
});
