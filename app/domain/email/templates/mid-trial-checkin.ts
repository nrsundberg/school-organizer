import type { MidTrialCheckinMessage, RenderedEmail } from "../types";
import { getFixedT } from "~/lib/t.server";

/**
 * Day ~14 check-in, founder voice.
 *
 * i18n: copy lives under `email.midTrialCheckin.*`.
 */
export async function renderMidTrialCheckin(
  msg: MidTrialCheckinMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT(msg.locale ?? "en", "email");
  const firstName = firstNameOrFallback(msg.userName, t("common.greetingFallback"));
  const appLink = `https://${msg.orgSlug}.pickuproster.com`;

  const subject = t("midTrialCheckin.subject", { firstName });
  const preview = t("midTrialCheckin.preview");
  const greeting = t("midTrialCheckin.greeting", { firstName });
  const para1 = t("midTrialCheckin.para1");
  const para2 = t("midTrialCheckin.para2");
  const para3Text = t("midTrialCheckin.para3", { appLink });
  const para3Html = t("midTrialCheckin.para3Html", { appLink });
  const signOff = t("common.signOff");
  const signOffTitle = t("common.signOffTitle");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(para1)}</p>
    <p>${escapeHtml(para2)}</p>
    <p>${para3Html}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${greeting}

${para1}

${para2}

${para3Text}

--
${signOff}
${signOffTitle}`;

  return { subject, html, text };
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
