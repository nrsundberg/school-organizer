import { test } from "node:test";
import assert from "node:assert/strict";
import { redactQueryString, scrubSentryEvent } from "./sentry-scrub";

test("redactQueryString filters magic-link / reset tokens but keeps benign params", () => {
  assert.equal(
    redactQueryString("next=%2Fboard&token=deadbeefcafe"),
    "next=%2Fboard&token=[Filtered]",
  );
  assert.equal(redactQueryString("code=12345&page=2"), "code=[Filtered]&page=2");
  assert.equal(redactQueryString("page=2&sort=asc"), "page=2&sort=asc");
  assert.equal(redactQueryString(""), "");
});

test("redactQueryString matches keys ending in a sensitive word (e.g. resetToken)", () => {
  assert.equal(redactQueryString("resetToken=abc"), "resetToken=[Filtered]");
});

test("scrubSentryEvent strips cookies, auth header, body and url/query tokens", () => {
  const event = {
    request: {
      url: "https://tome.pickuproster.com/viewer-access?next=%2F&token=secret123",
      query_string: "next=%2F&token=secret123",
      cookies: { pickuproster_viewer_session: "abc" },
      data: { password: "hunter2" },
      headers: {
        Cookie: "session=abc",
        Authorization: "Bearer xyz",
        "User-Agent": "test",
      },
    },
  };

  const out = scrubSentryEvent(event);

  assert.equal(out.request.cookies, undefined);
  assert.equal(out.request.data, undefined);
  assert.equal(out.request.headers.Cookie, undefined);
  assert.equal(out.request.headers.Authorization, undefined);
  // Non-sensitive header preserved.
  assert.equal(out.request.headers["User-Agent"], "test");
  // Token redacted in both url and query_string; benign param kept.
  assert.equal(
    out.request.url,
    "https://tome.pickuproster.com/viewer-access?next=%2F&token=[Filtered]",
  );
  assert.equal(out.request.query_string, "next=%2F&token=[Filtered]");
});

test("scrubSentryEvent tolerates events without a request", () => {
  const event = { message: "boom" } as Record<string, unknown>;
  assert.deepEqual(scrubSentryEvent(event), { message: "boom" });
});
