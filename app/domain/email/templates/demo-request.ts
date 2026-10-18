import type { DemoRequestMessage, RenderedEmail } from "../types";
import { getFixedT } from "~/lib/t.server";
import { escapeHtml } from "../html";

function formatWhen(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toISOString().replace(".000Z", "Z");
}

/**
 * Internal demo-request alert. English on purpose, same as the signup alert,
 * so the founder inbox always has the same fields.
 */
export async function renderDemoRequest(
  msg: DemoRequestMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT("en", "email");
  const vars = {
    name: msg.name,
    role: msg.role,
    school: msg.school,
    email: msg.email,
    phone: msg.phone?.trim() || t("demoRequest.notProvided"),
    studentCount: msg.studentCount?.trim() || t("demoRequest.notProvided"),
    message: msg.message?.trim() || t("demoRequest.notProvided"),
    submittedAt: formatWhen(msg.submittedAt),
  };

  const subject = t("demoRequest.subject", vars);
  const preview = t("demoRequest.preview", vars);
  const heading = t("demoRequest.heading");
  const lines = [
    t("demoRequest.name", vars),
    t("demoRequest.role", vars),
    t("demoRequest.school", vars),
    t("demoRequest.email", vars),
    t("demoRequest.phone", vars),
    t("demoRequest.studentCount", vars),
    t("demoRequest.message", vars),
    t("demoRequest.when", vars),
  ];

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p><strong>${escapeHtml(heading)}</strong></p>
    <ul>
      ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("\n      ")}
    </ul>
  </body>
</html>`;

  const text = `${heading}\n\n${lines.join("\n")}`;
  return { subject, html, text, replyTo: msg.email };
}
