import test from "node:test";
import assert from "node:assert/strict";
import { renderSupportTicketNotice, renderSupportTicketReply } from "./support-ticket";

test("ticket notice emails Noah with the requester as reply-to", async () => {
  const rendered = await renderSupportTicketNotice({
    kind: "support_ticket_notice",
    to: "NoahSundberg@gmail.com",
    ticketId: "tkt_1",
    requesterName: "Ada <script>",
    requesterEmail: "ada@school.edu",
    source: "chat",
    subject: "Where is billing?",
    message: "Need the billing page.",
    pagePath: "/admin",
    inboxUrl: "https://pickuproster.com/platform/support/tkt_1",
  });
  assert.match(rendered.subject, /\[Support \/ chat\]/);
  assert.match(rendered.text, /ada@school.edu/);
  assert.match(rendered.text, /platform\/support\/tkt_1/);
  assert.equal(rendered.replyTo, "ada@school.edu");
  assert.equal(rendered.html.includes("<script>"), false);
  assert.match(rendered.html, /&lt;script&gt;/);
});

test("ticket reply emails the requester and links the thread", async () => {
  const rendered = await renderSupportTicketReply({
    kind: "support_ticket_reply",
    to: "ada@school.edu",
    requesterName: "Ada",
    subject: "Where is billing?",
    replyBody: "Billing lives under Admin.",
    threadUrl: "https://pickuproster.com/support/abc",
    replyTo: "support@pickuproster.com",
  });
  assert.equal(rendered.subject, "Re: Where is billing?");
  assert.match(rendered.text, /Admin/);
  assert.match(rendered.text, /\/support\/abc/);
  assert.equal(rendered.replyTo, "support@pickuproster.com");
});
