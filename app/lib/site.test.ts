import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SUPPORT_EMAIL, getSupportEmail } from "./site";

test("getSupportEmail returns DEFAULT_SUPPORT_EMAIL when env is empty", () => {
  const result = getSupportEmail({});
  assert.equal(result, DEFAULT_SUPPORT_EMAIL);
});

test("getSupportEmail returns context.cloudflare.env.SUPPORT_EMAIL when set", () => {
  const context = { cloudflare: { env: { SUPPORT_EMAIL: "cf@example.com" } } };
  assert.equal(getSupportEmail(context), "cf@example.com");
});

test("getSupportEmail returns process.env.SUPPORT_EMAIL when cloudflare env is absent", () => {
  const original = process.env.SUPPORT_EMAIL;
  try {
    process.env.SUPPORT_EMAIL = "proc@example.com";
    assert.equal(getSupportEmail({}), "proc@example.com");
  } finally {
    if (original === undefined) {
      delete process.env.SUPPORT_EMAIL;
    } else {
      process.env.SUPPORT_EMAIL = original;
    }
  }
});

test("getSupportEmail prefers context.cloudflare.env over process.env", () => {
  const original = process.env.SUPPORT_EMAIL;
  try {
    process.env.SUPPORT_EMAIL = "proc@example.com";
    const context = { cloudflare: { env: { SUPPORT_EMAIL: "cf@example.com" } } };
    assert.equal(getSupportEmail(context), "cf@example.com");
  } finally {
    if (original === undefined) {
      delete process.env.SUPPORT_EMAIL;
    } else {
      process.env.SUPPORT_EMAIL = original;
    }
  }
});
