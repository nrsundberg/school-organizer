import type { PasswordResetMessage, RenderedEmail } from "../types";
import { getFixedT } from "~/lib/t.server";

/**
 * Transactional password reset. One CTA: the reset link. We intentionally
 * do NOT set a `replyTo` override — replies should land at the From address
 * (noah@pickuproster.com) so recovery traffic is not routed through the
 * founder's personal inbox like the welcome email is.
 */
export async function renderPasswordReset(
  msg: PasswordResetMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT(msg.locale ?? "en", "email");
  const firstName = firstNameOrFallback(msg.firstName, t("common.greetingFallback"));
  const ip = msg.requestIp?.trim();
  const requestIpSuffix = ip ? t("passwordReset.requestIpSuffix", { ip }) : "";

  const subject = t("passwordReset.subject");
  const preview = t("passwordReset.preview");
  const greeting = t("passwordReset.greeting", { firstName });
  const intro = t("passwordReset.intro");
  const buttonLabel = t("passwordReset.buttonLabel");
  const fallbackPrefix = t("passwordReset.fallbackPrefix");
  const expires = t("passwordReset.expires", { expiryMinutes: msg.expiryMinutes });
  const didNotRequest = t("passwordReset.didNotRequest", { requestIpSuffix });
  const textIntro = t("passwordReset.textIntro");

  const resetUrl = msg.resetUrl;

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(intro)}</p>
    <p style="margin: 24px 0;">
      <a href="${escapeAttr(resetUrl)}" style="background:#E9D500;color:#193B4B;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">${escapeHtml(buttonLabel)}</a>
    </p>
    <p style="font-size: 13px; color: #555;">${escapeHtml(fallbackPrefix)}<br /><a href="${escapeAttr(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
    <p>${escapeHtml(expires)}</p>
    <hr />
    <p style="font-size: 12px; color: #666;">
      ${escapeHtml(didNotRequest)}
    </p>
  </body>
</html>`;

  const text = `${greeting}

${textIntro}

${resetUrl}

${expires}

${didNotRequest}`;

  return {
    subject,
    html,
    text,
    // No replyTo override — replies go to the default From address.
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
