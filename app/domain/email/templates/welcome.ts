import type { RenderedEmail, WelcomeMessage } from "../types";
import { interpolate } from "../interpolate";

// Founder-voice welcome email (Variant A — gratitude-led). Replies land in
// Noah's personal inbox via the Reply-To header set by the send wrapper.
// Variables: {{ firstName }}, {{ orgName }}.
const SUBJECT = "thanks for trying PickupRoster, {{ firstName }}";
const PREVIEW = "a quick note from the founder — and a small ask.";

const HTML = `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; line-height: 1.5;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${PREVIEW}</span>
    <p>Hi {{ firstName }},</p>
    <p>Thank you for signing up. Helping schools run a calmer pickup is the whole reason I started PickupRoster, so it genuinely means a lot that {{ orgName }} gave it a shot.</p>
    <p>I'd love to hear what dismissal actually looks like at your school right now — what's working, what's not, and what you wish someone would fix. Could we grab 15 minutes on the phone in the next week or two?</p>
    <p>Just hit reply with a couple of times that work for you and I'll send an invite.</p>
    <p>Either way, I'm glad you're here.</p>
    <hr />
    <p>Noah<br />Founder, PickupRoster</p>
  </body>
</html>`;

const TEXT = `Hi {{ firstName }},

Thank you for signing up. Helping schools run a calmer pickup is the whole reason I started PickupRoster, so it genuinely means a lot that {{ orgName }} gave it a shot.

I'd love to hear what dismissal actually looks like at your school right now — what's working, what's not, and what you wish someone would fix. Could we grab 15 minutes on the phone in the next week or two?

Just hit reply with a couple of times that work for you and I'll send an invite.

Either way, I'm glad you're here.

--
Noah
Founder, PickupRoster`;

export function renderWelcome(msg: WelcomeMessage): RenderedEmail {
  const vars = {
    orgName: msg.orgName,
    firstName: firstNameOrFallback(msg.userName),
  };
  return {
    subject: interpolate(SUBJECT, vars),
    html: interpolate(HTML, vars),
    text: interpolate(TEXT, vars),
    // Route replies to the founder's personal inbox.
    replyTo: "noahsundberg@gmail.com",
  };
}

function firstNameOrFallback(name: string | null | undefined): string {
  if (!name) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}
