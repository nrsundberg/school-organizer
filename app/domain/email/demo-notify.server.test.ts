import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIGNUP_NOTIFY_EMAIL } from "~/lib/site";
import { notifyDemoRequest } from "./demo-notify.server";

const WHEN = new Date("2026-10-18T18:00:00.000Z");

test("notifyDemoRequest enqueues the form fields to the signup inbox", async () => {
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

  await notifyDemoRequest(
    context,
    {
      name: "Ada Lovelace",
      role: "Principal",
      school: "Maple Elementary",
      email: "ada@maple.edu",
      phone: "555-0100",
      studentCount: "420",
      message: "Radios today.",
    },
    WHEN,
  );

  assert.deepEqual(sent, [
    {
      kind: "demo_request",
      to: DEFAULT_SIGNUP_NOTIFY_EMAIL,
      name: "Ada Lovelace",
      role: "Principal",
      school: "Maple Elementary",
      email: "ada@maple.edu",
      phone: "555-0100",
      studentCount: "420",
      message: "Radios today.",
      submittedAt: "2026-10-18T18:00:00.000Z",
      locale: "en",
    },
  ]);
  assert.equal(DEFAULT_SIGNUP_NOTIFY_EMAIL, "NoahSundberg@gmail.com");
});

test("notifyDemoRequest does not throw when the queue is missing", async () => {
  await assert.doesNotReject(() =>
    notifyDemoRequest(
      {},
      {
        name: "Ada",
        role: "Principal",
        school: "Maple",
        email: "ada@maple.edu",
        phone: "",
        studentCount: "",
        message: "",
      },
      WHEN,
    ),
  );
});
