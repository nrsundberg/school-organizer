import type { PasswordResetMessage, RenderedEmail } from "../types";
import { interpolate } from "../interpolate";

// Transactional password reset. One CTA: the reset link. We intentionally
// do NOT set a `replyTo` override — replies should land at the From address
// (noah@pickuproster.com) so recovery traffic is not routed through the
// founder's personal inbox like the welcome email is.
//
// Variables: {{ firstName }}, {{ resetUrl }}, {{ expiryMinutes }}, {{ requestIp }}.
const SUBJECT = "Reset your PickupRoster password";
const PREVIEW = "Use this link to choose a new password.";

const HTML = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${PREVIEW}</span>
    <p>Hi {{ firstName }},</p>
    <p>We got a request to reset the password for your PickupRoster account. Click the button below to choose a new one.</p>
    <p style="margin: 24px 0;">
      <a href="{{ resetUrl }}" style="background:#E9D500;color:#193B4B;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">Reset password</a>
    </p>
    <p style="font-size: 13px; color: #555;">Or paste this link into your browser:<br /><a href="{{ resetUrl }}">{{ resetUrl }}</a></p>
    <p>This link expires in {{ expiryMinutes }} minutes.</p>
    <hr />
    <p style="font-size: 12px; color: #666;">
      If you didn't request this, you can ignore this email — your password won't change{{ requestIpSuffix }}.
    </p>
  </body>
</html>`;

const TEXT = `Hi {{ firstName }},

We got a request to reset the password for your PickupRoster account. Use the link below to choose a new one:

{{ resetUrl }}

This link expires in {{ expiryMinutes }} minutes.

If you didn't request this, you can ignore this email — your password won't change{{ requestIpSuffix }}.`;

export function renderPasswordReset(msg: PasswordResetMessage): RenderedEmail {
  const ip = msg.requestIp?.trim();
  const requestIpSuffix = ip ? ` (request came from ${ip})` : "";
  const vars = {
    firstName: firstNameOrFallback(msg.firstName),
    resetUrl: msg.resetUrl,
    expiryMinutes: msg.expiryMinutes,
    requestIpSuffix,
  };
  return {
    subject: interpolate(SUBJECT, vars),
    html: interpolate(HTML, vars),
    text: interpolate(TEXT, vars),
    // No replyTo override — replies go to the default From address.
  };
}

function firstNameOrFallback(name: string | null | undefined): string {
  if (!name) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}
