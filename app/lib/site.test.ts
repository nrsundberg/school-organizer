import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIGNUP_NOTIFY_EMAIL,
  DEFAULT_SUPPORT_EMAIL,
  getDemoBookingUrl,
  getIntroCallBookingUrl,
  getMeetingUrl,
  getSignupNotifyEmail,
  getSupportEmail,
  getSupportNotifyEmail,
  DEFAULT_SUPPORT_NOTIFY_EMAIL,
  zoomJoinDetails,
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

test("getSupportNotifyEmail defaults to Noah and honors a valid override", () => {
  assert.equal(getSupportNotifyEmail({}), DEFAULT_SUPPORT_NOTIFY_EMAIL);
  assert.equal(
    getSupportNotifyEmail({
      cloudflare: { env: { SUPPORT_NOTIFY_EMAIL: "ops@pickuproster.com" } },
    }),
    "ops@pickuproster.com",
  );
  assert.equal(
    getSupportNotifyEmail({
      cloudflare: { env: { SUPPORT_NOTIFY_EMAIL: "not-an-email" } },
    }),
    DEFAULT_SUPPORT_NOTIFY_EMAIL,
  );
});

test("getIntroCallBookingUrl defaults to the in-app page and accepts http(s) overrides", () => {
  assert.equal(getIntroCallBookingUrl({}), "https://pickuproster.com/book/intro");
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "" } },
    }),
    "https://pickuproster.com/book/intro",
  );
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "javascript:alert(1)" } },
    }),
    "https://pickuproster.com/book/intro",
  );
  assert.equal(
    getIntroCallBookingUrl({
      cloudflare: {
        env: {
          PUBLIC_ROOT_DOMAIN: "staging.pickuproster.com",
        },
      },
    }),
    "https://staging.pickuproster.com/book/intro",
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

test("getDemoBookingUrl defaults to /demo and prefers a valid override", () => {
  assert.equal(getDemoBookingUrl({}), "https://pickuproster.com/demo");
  assert.equal(
    getDemoBookingUrl({
      cloudflare: { env: { INTRO_CALL_BOOKING_URL: "https://cal.example/intro" } },
    }),
    "https://pickuproster.com/demo",
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
    "https://pickuproster.com/demo",
  );
});

test("getMeetingUrl prefers ZOOM_MEETING_URL and falls back to MEETING_URL", () => {
  assert.equal(getMeetingUrl({}), null);
  assert.equal(
    getMeetingUrl({
      cloudflare: { env: { MEETING_URL: "https://zoom.us/j/fallback" } },
    }),
    "https://zoom.us/j/fallback",
  );
  assert.equal(
    getMeetingUrl({
      cloudflare: {
        env: {
          ZOOM_MEETING_URL: "https://zoom.us/j/primary",
          MEETING_URL: "https://zoom.us/j/fallback",
        },
      },
    }),
    "https://zoom.us/j/primary",
  );
  assert.equal(
    getMeetingUrl({
      cloudflare: { env: { ZOOM_MEETING_URL: "javascript:alert(1)", MEETING_URL: "https://zoom.us/j/fallback" } },
    }),
    "https://zoom.us/j/fallback",
  );
});

test("zoomJoinDetails prints the personal room id and passcode only for that room", () => {
  assert.deepEqual(
    zoomJoinDetails(
      "https://us05web.zoom.us/j/3504620740?pwd=kFLGxaFkDuO8z0q4KLXIBlLzfsYQib.1",
    ),
    { id: "350 462 0740", passcode: "Zd8X3j" },
  );
  assert.equal(zoomJoinDetails("https://zoom.us/j/123456789"), null);
  assert.equal(zoomJoinDetails(null), null);
});
