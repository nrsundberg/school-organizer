import type { RenderedEmail, TrialExpiringMessage } from "../types";
import { getFixedT } from "~/lib/t.server";
import type { TFunction } from "i18next";

/**
 * Trial-expiring copy has three variants keyed off `daysLeft` (7 / 3 / 1).
 *
 * i18n: copy lives under `email.trialExpiring.{seven,three,one}.*`.
 */

type VariantKey = "seven" | "three" | "one";

function pickVariantKey(daysLeft: number): VariantKey {
  if (daysLeft <= 1) return "one";
  if (daysLeft <= 3) return "three";
  return "seven";
}

export async function renderTrialExpiring(
  msg: TrialExpiringMessage,
): Promise<RenderedEmail> {
  const t = await getFixedT(msg.locale ?? "en", "email");
  const variantKey = pickVariantKey(msg.daysLeft);
  const firstName = firstNameOrFallback(msg.userName, t("common.greetingFallback"));
  const appLink = `https://${msg.orgSlug}.pickuproster.com/admin/billing`;
  const interp = {
    firstName,
    orgName: msg.orgName,
    daysLeft: msg.daysLeft,
    trialEndDate: msg.trialEndDate,
    appLink,
  };

  switch (variantKey) {
    case "one":
      return renderOne(t, interp);
    case "three":
      return renderThree(t, interp);
    case "seven":
    default:
      return renderSeven(t, interp);
  }
}

type Vars = {
  firstName: string;
  orgName: string;
  daysLeft: number;
  trialEndDate: string;
  appLink: string;
};

function renderSeven(t: TFunction, vars: Vars): RenderedEmail {
  const subject = t("trialExpiring.seven.subject");
  const preview = t("trialExpiring.seven.preview", vars);
  const greeting = t("trialExpiring.seven.greeting", vars);
  const para1 = t("trialExpiring.seven.para1", vars);
  const para2 = t("trialExpiring.seven.para2", vars);
  const para3Text = t("trialExpiring.seven.para3", vars);
  const para3Html = t("trialExpiring.seven.para3Html", vars);
  const para4 = t("trialExpiring.seven.para4");
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
    <p>${escapeHtml(para4)}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${greeting}

${para1}

${para2}

${para3Text}

${para4}

--
${signOff}
${signOffTitle}`;

  return { subject, html, text };
}

function renderThree(t: TFunction, vars: Vars): RenderedEmail {
  const subject = t("trialExpiring.three.subject", vars);
  const preview = t("trialExpiring.three.preview", vars);
  const greeting = t("trialExpiring.three.greeting", vars);
  const para1 = t("trialExpiring.three.para1", vars);
  const para2 = t("trialExpiring.three.para2", vars);
  const para3Text = t("trialExpiring.three.para3", vars);
  const para3Html = t("trialExpiring.three.para3Html", vars);
  const para4 = t("trialExpiring.three.para4");
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
    <p>${escapeHtml(para4)}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${greeting}

${para1}

${para2}

${para3Text}

${para4}

--
${signOff}
${signOffTitle}`;

  return { subject, html, text };
}

function renderOne(t: TFunction, vars: Vars): RenderedEmail {
  const subject = t("trialExpiring.one.subject");
  const preview = t("trialExpiring.one.preview", vars);
  const greeting = t("trialExpiring.one.greeting", vars);
  const para1Text = t("trialExpiring.one.para1", vars);
  const para1Html = t("trialExpiring.one.para1Html", vars);
  const signOff = t("common.signOff");
  const signOffTitle = t("common.signOffTitle");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <p>${escapeHtml(greeting)}</p>
    <p>${para1Html}</p>
    <hr />
    <p>${escapeHtml(signOff)}<br />${escapeHtml(signOffTitle)}</p>
  </body>
</html>`;

  const text = `${greeting}

${para1Text}

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
