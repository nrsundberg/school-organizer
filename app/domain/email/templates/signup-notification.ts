import type { RenderedEmail, SignupNotificationMessage } from "../types";
import { getFixedT } from "~/lib/t.server";
import { escapeHtml } from "../html";

function formatSignedUpAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toISOString().replace(".000Z", "Z");
}

/**
 * Internal signup alert. Copy is English (`locale` is ignored on purpose so
 * Noah always gets the same fields regardless of the school's language).
 */
export async function renderSignupNotification(
  msg: SignupNotificationMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT("en", "email");
  const personName = msg.personName?.trim() || msg.personEmail;
  const signedUpAt = formatSignedUpAt(msg.signedUpAt);
  const vars = {
    schoolName: msg.schoolName,
    personName,
    personEmail: msg.personEmail,
    plan: msg.plan,
    signedUpAt,
  };

  const subject = t("signupNotification.subject", vars);
  const preview = t("signupNotification.preview", vars);
  const heading = t("signupNotification.heading");
  const school = t("signupNotification.school", vars);
  const person = t("signupNotification.person", vars);
  const email = t("signupNotification.email", vars);
  const plan = t("signupNotification.plan", vars);
  const when = t("signupNotification.when", vars);

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p><strong>${escapeHtml(heading)}</strong></p>
    <ul>
      <li>${escapeHtml(school)}</li>
      <li>${escapeHtml(person)}</li>
      <li>${escapeHtml(email)}</li>
      <li>${escapeHtml(plan)}</li>
      <li>${escapeHtml(when)}</li>
    </ul>
  </body>
</html>`;

  const text = `${heading}

${school}
${person}
${email}
${plan}
${when}`;

  return { subject, html, text };
}
