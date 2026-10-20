import type {
  RenderedEmail,
  SupportTicketNoticeMessage,
  SupportTicketReplyMessage,
} from "../types";
import { escapeAttr, escapeHtml } from "../html";

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

export async function renderSupportTicketNotice(
  msg: SupportTicketNoticeMessage,
): Promise<RenderedEmail> {
  const page = msg.pagePath ?? "not provided";
  const subject = `[Support / ${msg.source}] ${msg.subject}`;
  const rows = [
    line("From", msg.requesterName),
    line("Email", msg.requesterEmail),
    line("Source", msg.source),
    line("Page", page),
    line("Ticket", msg.ticketId),
  ];
  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <p><strong>New PickupRoster support ticket</strong></p>
    <ul>
      ${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("\n      ")}
    </ul>
    <p style="white-space: pre-wrap;">${escapeHtml(msg.message)}</p>
    <p><a href="${escapeAttr(msg.inboxUrl)}">Open in the support inbox</a></p>
  </body>
</html>`;
  const text = [
    "New PickupRoster support ticket",
    "",
    ...rows,
    "",
    msg.message,
    "",
    `Open in the support inbox: ${msg.inboxUrl}`,
  ].join("\n");
  return { subject, html, text, replyTo: msg.requesterEmail };
}

export async function renderSupportTicketReply(
  msg: SupportTicketReplyMessage,
): Promise<RenderedEmail> {
  const subject = `Re: ${msg.subject}`;
  const greeting = msg.requesterName.trim() || "there";
  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <p>Hi ${escapeHtml(greeting)},</p>
    <p style="white-space: pre-wrap;">${escapeHtml(msg.replyBody)}</p>
    <p>You can read the conversation here:<br />
      <a href="${escapeAttr(msg.threadUrl)}">${escapeHtml(msg.threadUrl)}</a>
    </p>
    <p>PickupRoster support</p>
  </body>
</html>`;
  const text = [
    `Hi ${greeting},`,
    "",
    msg.replyBody,
    "",
    `You can read the conversation here: ${msg.threadUrl}`,
    "",
    "PickupRoster support",
  ].join("\n");
  return { subject, html, text, replyTo: msg.replyTo };
}
