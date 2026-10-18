import assert from "node:assert/strict";
import test from "node:test";

import { renderSignupNotification } from "./signup-notification";
import { renderWelcome } from "./welcome";

test("signup notification email includes school, person, plan, and timestamp", async () => {
  const rendered = await renderSignupNotification({
    kind: "signup_notification",
    to: "NoahSundberg@gmail.com",
    schoolName: "Maple Elementary",
    personName: "Ada Lovelace",
    personEmail: "ada@maple.edu",
    plan: "CAMPUS",
    signedUpAt: "2026-10-18T13:43:00.000Z",
  });

  assert.match(rendered.subject, /Maple Elementary/);
  assert.match(rendered.text, /Maple Elementary/);
  assert.match(rendered.text, /Ada Lovelace/);
  assert.match(rendered.text, /ada@maple\.edu/);
  assert.match(rendered.text, /CAMPUS/);
  assert.match(rendered.text, /2026-10-18T13:43:00Z/);
  assert.match(rendered.html, /Maple Elementary/);
});

test("welcome email offers two free 30-minute intro calls", async () => {
  const rendered = await renderWelcome({
    kind: "welcome",
    to: "ada@maple.edu",
    orgName: "Maple Elementary",
    orgSlug: "maple",
    userName: "Ada Lovelace",
  });

  assert.match(rendered.text, /two free 30-minute intro calls/i);
  assert.match(rendered.html, /two free 30-minute intro calls/i);
  assert.doesNotMatch(rendered.text, /https?:\/\//);
});

test("welcome email drops a non-http booking link", async () => {
  const rendered = await renderWelcome({
    kind: "welcome",
    to: "ada@maple.edu",
    orgName: "Maple Elementary",
    orgSlug: "maple",
    userName: "Ada",
    introCallBookingUrl: "javascript:alert(1)",
  });

  assert.doesNotMatch(rendered.html, /javascript:/i);
  assert.doesNotMatch(rendered.text, /javascript:/i);
});

test("welcome email includes the booking link only when one is configured", async () => {
  const rendered = await renderWelcome({
    kind: "welcome",
    to: "ada@maple.edu",
    orgName: "Maple Elementary",
    orgSlug: "maple",
    userName: "Ada",
    introCallBookingUrl: "https://cal.example/intro",
  });

  assert.match(rendered.text, /https:\/\/cal\.example\/intro/);
  assert.match(rendered.html, /href="https:\/\/cal\.example\/intro"/);
});
