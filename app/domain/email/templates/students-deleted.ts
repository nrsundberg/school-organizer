import type { RenderedEmail, StudentsDeletedMessage } from "../types";
import { getFixedT } from "~/lib/t.server";
import { escapeHtml } from "../html";

/**
 * Notification that student records in an org were deleted in bulk. Sent to
 * every org admin and to Pickup Roster ops, so a surprise deletion is caught
 * while it is still recoverable from database backups.
 *
 * Two sources share this template: the dashboard Danger Zone ("all student
 * records") and a roster import run with removals enabled (a partial prune of
 * students absent from the uploaded file). The `*Prune` copy variants keep the
 * partial case from claiming the whole roster was wiped.
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

  const suffix = msg.source === "roster_import" ? "Prune" : "";
  const subject = t(`studentsDeleted.subject${suffix}`, vars);
  const preview = t(`studentsDeleted.preview${suffix}`, vars);
  const heading = t("studentsDeleted.heading");
  const para1 = t(
    msg.isOps
      ? `studentsDeleted.para1Ops${suffix}`
      : `studentsDeleted.para1${suffix}`,
    vars,
  );
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
