import type { MidTrialCheckinMessage, RenderedEmail } from "../types";
import { interpolate } from "../interpolate";

// Day ~14 check-in, founder voice. Variables: {{ firstName }}, {{ appLink }}.
const SUBJECT = "how's pickup going, {{ firstName }}?";
const PREVIEW = "checking in — no agenda, just want to make sure it's useful.";

const HTML = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${PREVIEW}</span>
    <p>Hi {{ firstName }},</p>
    <p>You're about halfway through your trial. I wanted to check in — not to sell you anything, just to see how it's going.</p>
    <p>If something's confusing, clunky, or missing, hit reply and tell me. I read every email and I'd rather hear it now than not at all.</p>
    <p>If you want to poke around some more, you can jump back in here: <a href="{{ appLink }}">{{ appLink }}</a></p>
    <hr />
    <p>Noah<br />Founder, PickupRoster</p>
  </body>
</html>`;

const TEXT = `Hi {{ firstName }},

You're about halfway through your trial. I wanted to check in — not to sell you anything, just to see how it's going.

If something's confusing, clunky, or missing, hit reply and tell me. I read every email and I'd rather hear it now than not at all.

If you want to poke around some more, you can jump back in here: {{ appLink }}

--
Noah
Founder, PickupRoster`;

export function renderMidTrialCheckin(msg: MidTrialCheckinMessage): RenderedEmail {
  const vars = {
    orgName: msg.orgName,
    orgSlug: msg.orgSlug,
    daysIn: msg.daysIn,
    firstName: firstNameOrFallback(msg.userName),
    appLink: `https://${msg.orgSlug}.pickuproster.com`,
  };
  return {
    subject: interpolate(SUBJECT, vars),
    html: interpolate(HTML, vars),
    text: interpolate(TEXT, vars),
  };
}

function firstNameOrFallback(name: string | null | undefined): string {
  if (!name) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}
