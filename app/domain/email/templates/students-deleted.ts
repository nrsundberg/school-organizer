import type { RenderedEmail, StudentsDeletedMessage } from "../types";
import { getFixedT } from "~/lib/t.server";
import { escapeHtml } from "../html";

/**
 * Notification that all student records in an org were deleted via the
 * dashboard Danger Zone. Sent to every org admin and to Pickup Roster ops.
 *
 * i18n: copy lives under the `email.studentsDeleted.*` namespace. The
 * recipient's `locale` flows in from the queue message; default is English.
 */
export async function renderStudentsDeleted(
  msg: StudentsDeletedMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT(msg.locale ?? "en", "email");
  const vars = {
    orgName: msg.orgName,
    actor: msg.actorLabel,
    count: msg.deletedCount,
    when: msg.deletedAt,
  };

  const subject = t("studentsDeleted.subject", vars);
  const preview = t("studentsDeleted.preview", vars);
  const heading = t("studentsDeleted.heading");
  const para1 = t(msg.isOps ? "studentsDeleted.para1Ops" : "studentsDeleted.para1", vars);
  const para2 = t("studentsDeleted.para2", vars);
  const recovery = t("studentsDeleted.recovery", vars);
  const signOff = t("common.signOff");
  const signOffTitle = t("common.signOffTitle");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p><strong>${escapeHtml(heading)}</strong></p>
    <p>${escapeHtml(para1)}</p>
    <p>${escapeHtml(para2)}</p>
    <p style="padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">${escapeHtml(recovery)}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${heading}

${para1}

${para2}

${recovery}

--
${signOff}
${signOffTitle}`;

  return { subject, html, text };
}
