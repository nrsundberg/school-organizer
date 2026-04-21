import type { RenderedEmail, TrialExpiringMessage } from "../types";
import { interpolate } from "../interpolate";

// Trial-expiring copy has three variants keyed off `daysLeft` (7 / 3 / 1).
// Variables: {{ firstName }}, {{ orgName }}, {{ daysLeft }}, {{ trialEndDate }},
// {{ appLink }}.

type Variant = {
  subject: string;
  preview: string;
  html: string;
  text: string;
};

// ---- 7 days out ----
const SEVEN: Variant = {
  subject: "a week left on your PickupRoster trial",
  preview: "{{ daysLeft }} days to keep your setup — here's how.",
  html: `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">{{ daysLeft }} days to keep your setup — here's how.</span>
    <p>Hi {{ firstName }},</p>
    <p>Quick heads up: your trial ends on {{ trialEndDate }}, about a week from now.</p>
    <p>If pickup has felt a little less chaotic at {{ orgName }} lately, that's the thing worth keeping. Upgrading now means no interruption, your roster stays put, and tomorrow's dismissal runs exactly like today's.</p>
    <p>You can upgrade in a couple of clicks here: <a href="{{ appLink }}">{{ appLink }}</a></p>
    <p>Questions? Just reply — I'll answer.</p>
    <hr />
    <p>Noah<br />Founder, PickupRoster</p>
  </body>
</html>`,
  text: `Hi {{ firstName }},

Quick heads up: your trial ends on {{ trialEndDate }}, about a week from now.

If pickup has felt a little less chaotic at {{ orgName }} lately, that's the thing worth keeping. Upgrading now means no interruption, your roster stays put, and tomorrow's dismissal runs exactly like today's.

You can upgrade in a couple of clicks here: {{ appLink }}

Questions? Just reply — I'll answer.

--
Noah
Founder, PickupRoster`,
};

// ---- 3 days out ----
const THREE: Variant = {
  subject: "3 days left, {{ firstName }}",
  preview: "don't want you to lose your setup at {{ orgName }}.",
  html: `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">don't want you to lose your setup at {{ orgName }}.</span>
    <p>Hi {{ firstName }},</p>
    <p>Your trial wraps on {{ trialEndDate }} — just 3 days out.</p>
    <p>I don't want you to lose the setup you've built for {{ orgName }}, or wake up next week to a dismissal line that's back to the old way. Upgrading takes about a minute and everything keeps running.</p>
    <p>Upgrade here: <a href="{{ appLink }}">{{ appLink }}</a></p>
    <p>If there's a reason you're holding off, tell me. I want to know.</p>
    <hr />
    <p>Noah<br />Founder, PickupRoster</p>
  </body>
</html>`,
  text: `Hi {{ firstName }},

Your trial wraps on {{ trialEndDate }} — just 3 days out.

I don't want you to lose the setup you've built for {{ orgName }}, or wake up next week to a dismissal line that's back to the old way. Upgrading takes about a minute and everything keeps running.

Upgrade here: {{ appLink }}

If there's a reason you're holding off, tell me. I want to know.

--
Noah
Founder, PickupRoster`,
};

// ---- Tomorrow (1 day out) ----
const ONE: Variant = {
  subject: "your trial ends tomorrow",
  preview: "one click to keep PickupRoster running at {{ orgName }}.",
  html: `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">one click to keep PickupRoster running at {{ orgName }}.</span>
    <p>Hi {{ firstName }},</p>
    <p>Your trial ends tomorrow. To keep PickupRoster running at {{ orgName }} without a gap, upgrade here: <a href="{{ appLink }}">{{ appLink }}</a></p>
    <hr />
    <p>Noah<br />Founder, PickupRoster</p>
  </body>
</html>`,
  text: `Hi {{ firstName }},

Your trial ends tomorrow. To keep PickupRoster running at {{ orgName }} without a gap, upgrade here: {{ appLink }}

--
Noah
Founder, PickupRoster`,
};

function pickVariant(daysLeft: number): Variant {
  if (daysLeft <= 1) return ONE;
  if (daysLeft <= 3) return THREE;
  return SEVEN;
}

export function renderTrialExpiring(msg: TrialExpiringMessage): RenderedEmail {
  const variant = pickVariant(msg.daysLeft);
  const vars = {
    orgName: msg.orgName,
    orgSlug: msg.orgSlug,
    daysLeft: msg.daysLeft,
    trialEndDate: msg.trialEndDate,
    firstName: firstNameOrFallback(msg.userName),
    appLink: `https://${msg.orgSlug}.pickuproster.com/admin/billing`,
  };
  return {
    subject: interpolate(variant.subject, vars),
    html: interpolate(variant.html, vars),
    text: interpolate(variant.text, vars),
  };
}

function firstNameOrFallback(name: string | null | undefined): string {
  if (!name) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}
