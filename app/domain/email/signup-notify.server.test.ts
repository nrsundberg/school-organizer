import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SIGNUP_NOTIFY_EMAIL } from "~/lib/site";
import { notifyNewSignup } from "./signup-notify.server";

const WHEN = new Date("2026-10-18T13:43:00.000Z");

function notice() {
  return {
    schoolName: "Maple Elementary",
    personName: "Ada Lovelace",
    personEmail: "ada@maple.edu",
    plan: "CAR_LINE",
    signedUpAt: WHEN,
  };
}

test("notifyNewSignup enqueues school, person, plan, and timestamp", async () => {
  const sent: unknown[] = [];
  const context = {
    cloudflare: {
      env: {
        EMAIL_QUEUE: {
          async send(msg: unknown) {
            sent.push(msg);
          },
        },
      },
    },
  };

  await notifyNewSignup(context, notice());

  assert.deepEqual(sent, [
    {
      kind: "signup_notification",
      to: DEFAULT_SIGNUP_NOTIFY_EMAIL,
      schoolName: "Maple Elementary",
      personName: "Ada Lovelace",
      personEmail: "ada@maple.edu",
      plan: "CAR_LINE",
      signedUpAt: "2026-10-18T13:43:00.000Z",
      locale: "en",
    },
  ]);
});

test("notifyNewSignup does not throw when the queue send fails", async () => {
  const context = {
    cloudflare: {
      env: {
        EMAIL_QUEUE: {
          async send() {
            throw new Error("queue unavailable");
          },
        },
      },
    },
  };

  await assert.doesNotReject(() => notifyNewSignup(context, notice()));
});

test("notifyNewSignup does not throw when the email queue binding is missing", async () => {
  await assert.doesNotReject(() => notifyNewSignup({}, notice()));
});
