import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIGNUP_NOTIFY_EMAIL,
  DEFAULT_SUPPORT_EMAIL,
  getDemoBookingUrl,
  getIntroCallBookingUrl,
  getSignupNotifyEmail,
  getSupportEmail,
} from "./site";

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

test("getSignupNotifyEmail defaults to Noah and honors a valid override", () => {
  assert.equal(getSignupNotifyEmail({}), DEFAULT_SIGNUP_NOTIFY_EMAIL);
  assert.equal(
    getSignupNotifyEmail({
      cloudflare: { env: { SIGNUP_NOTIFY_EMAIL: "ops@pickuproster.com" } },
    }),
    "ops@pickuproster.com",
  );
  assert.equal(
    getSignupNotifyEmail({
      cloudflare: { env: { SIGNUP_NOTIFY_EMAIL: "not-an-email" } },
    }),
    DEFAULT_SIGNUP_NOTIFY_EMAIL,
  );
});

test("getIntroCallBookingUrl accepts only http(s) URLs", () => {
  assert.equal(getIntroCallBookingUrl({}), null);
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "" } },
    }),
    null,
  );
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "javascript:alert(1)" } },
    }),
    null,
  );
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: {
        env: { INTRO_CALL_BOOKING_URL: "https://cal.example/intro" },
      },
    }),
    "https://cal.example/intro",
  );
});

test("getDemoBookingUrl prefers DEMO_BOOKING_URL and falls back to the intro calendar", () => {
  assert.equal(getDemoBookingUrl({}), null);
  assert.equal(
    getDemoBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "https://cal.example/intro" } },
    }),
    "https://cal.example/intro",
  );
  assert.equal(
    getDemoBookingUrl({
      cloudflare: {
        env: {
          DEMO_BOOKING_URL: "https://cal.example/demo",
          INTRO_CALL_BOOKING_URL: "https://cal.example/intro",
        },
      },
    }),
    "https://cal.example/demo",
  );
  assert.equal(
    getDemoBookingUrl({
      cloudflare: { env: { DEMO_BOOKING_URL: "javascript:alert(1)" } },
    }),
    null,
  );
});
