import assert from "node:assert/strict";
import test from "node:test";
import { renderDemoRequest } from "./demo-request";

test("demo request email includes the school and replies to the visitor", async () => {
  const rendered = await renderDemoRequest({
    kind: "demo_request",
    to: "NoahSundberg@gmail.com",
    name: "Ada Lovelace",
    role: "Principal",
    school: "Maple Elementary",
    email: "ada@maple.edu",
    phone: null,
    studentCount: "420",
    message: "We use radios.",
    submittedAt: "2026-10-18T18:00:00.000Z",
  });
  assert.match(rendered.subject, /Maple Elementary/);
  assert.match(rendered.text, /Ada Lovelace/);
  assert.match(rendered.text, /ada@maple.edu/);
  assert.match(rendered.text, /420/);
  assert.equal(rendered.replyTo, "ada@maple.edu");
});
