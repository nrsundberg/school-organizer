import type { UserInviteMessage, RenderedEmail } from "../types";

/**
 * Transactional invite email. Single CTA — the magic link to set a
 * password and finish signing up. We intentionally do NOT pull copy
 * through `getFixedT` yet: the i18n bundles don't have invite keys, so
 * adding translations would mean a 12-locale edit. Wire that in when we
 * localize the rest of the auth emails.
 */
export async function renderUserInvite(
  msg: UserInviteMessage,
): Promise<RenderedEmail> {
  const firstName = firstNameOrFallback(msg.firstName, "there");
  const inviteContext = msg.invitedToLabel
    ? `to join ${msg.invitedToLabel} on Pickup Roster`
    : "to the Pickup Roster team";
  const expiryClause =
    msg.expiryDays === 1
      ? "This link expires in 1 day."
      : `This link expires in ${msg.expiryDays} days.`;

  const subject = msg.invitedToLabel
    ? `You're invited to ${msg.invitedToLabel} on Pickup Roster`
    : "You're invited to Pickup Roster";
  const preview = `Set your password and sign in.`;
  const greeting = `Hi ${firstName},`;
  const intro = `You've been invited ${inviteContext}. Click the button below to set your password and sign in for the first time.`;
  const buttonLabel = "Accept invite";
  const fallbackPrefix = "Or copy and paste this link into your browser:";
  const didNotExpect =
    "If you weren't expecting this invite, you can safely ignore this email — no account is created until you set a password.";

  const inviteUrl = msg.inviteUrl;

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(intro)}</p>
    <p style="margin: 24px 0;">
      <a href="${escapeAttr(inviteUrl)}" style="background:#E9D500;color:#193B4B;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">${escapeHtml(buttonLabel)}</a>
    </p>
    <p style="font-size: 13px; color: #555;">${escapeHtml(fallbackPrefix)}<br /><a href="${escapeAttr(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
    <p>${escapeHtml(expiryClause)}</p>
    <hr />
    <p style="font-size: 12px; color: #666;">
      ${escapeHtml(didNotExpect)}
    </p>
  </body>
</html>`;

  const text = `${greeting}

${intro}

${inviteUrl}

${expiryClause}

${didNotExpect}`;

  return {
    subject,
    html,
    text,
  };
}

function firstNameOrFallback(
  name: string | null | undefined,
  fallback: string,
): string {
  if (!name) return fallback;
  const first = name.trim().split(/\s+/)[0];
  return first || fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
