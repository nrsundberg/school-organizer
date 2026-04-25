import type { RenderedEmail, WelcomeMessage } from "../types";
import { getFixedT } from "~/lib/t.server";

/**
 * Founder-voice welcome email (Variant A — gratitude-led). Replies land in
 * Noah's personal inbox via the Reply-To header set by the send wrapper.
 *
 * i18n: copy lives under the `email.welcome.*` namespace. The recipient's
 * `locale` flows in from the queue message; default is English.
 */
export async function renderWelcome(msg: WelcomeMessage): Promise<RenderedEmail> {
  const t = await getFixedT(msg.locale ?? "en", "email");
  const firstName = firstNameOrFallback(msg.userName, t("common.greetingFallback"));
  const orgName = msg.orgName;

  const subject = t("welcome.subject", { firstName });
  const preview = t("welcome.preview");
  const greeting = t("welcome.greeting", { firstName });
  const para1 = t("welcome.para1", { orgName });
  const para2 = t("welcome.para2");
  const para3 = t("welcome.para3");
  const para4 = t("welcome.para4");
  const signOff = t("common.signOff");
  const signOffTitle = t("common.signOffTitle");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(para1)}</p>
    <p>${escapeHtml(para2)}</p>
    <p>${escapeHtml(para3)}</p>
    <p>${escapeHtml(para4)}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${greeting}

${para1}

${para2}

${para3}

${para4}

--
${signOff}
${signOffTitle}`;

  return {
    subject,
    html,
    text,
    // Route replies to the founder's personal inbox.
    replyTo: "noahsundberg@gmail.com",
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
