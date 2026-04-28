import type { EmailMessage, RenderedEmail } from "../types";
import { renderWelcome } from "./welcome";
import { renderTrialExpiring } from "./trial-expiring";
import { renderMidTrialCheckin } from "./mid-trial-checkin";
import { renderPasswordReset } from "./password-reset";
import { renderUserInvite } from "./user-invite";

/**
 * Map an EmailMessage to a {subject, html, text} payload.
 *
 * Async because templates resolve their copy via `getFixedT` (which spins up a
 * per-call i18next instance — see `app/lib/t.server.ts`). The recipient
 * locale is read off `msg.locale` by each renderer; when omitted, templates
 * fall back to English.
 *
 * `publicRoot` (optional) is the consumer's `PUBLIC_ROOT_DOMAIN` —
 * `pickuproster.com` in prod, `staging.pickuproster.com` in staging.
 * Templates that embed a tenant-board URL (trial-expiring, mid-trial-checkin)
 * use it to anchor those URLs on the right environment so staging emails
 * don't link recipients into prod tenants. Templates that don't render a URL
 * ignore it.
 *
 * Exhaustive switch — TypeScript will error on the `never` if a new `kind`
 * is added to EmailMessage without a matching renderer here.
 */
export async function renderEmail(
  msg: EmailMessage,
  publicRoot?: string,
): Promise<RenderedEmail> {
  switch (msg.kind) {
    case "welcome":
      return renderWelcome(msg);
    case "trial_expiring":
      return renderTrialExpiring(msg, publicRoot);
    case "mid_trial_checkin":
      return renderMidTrialCheckin(msg, publicRoot);
    case "password_reset":
      return renderPasswordReset(msg);
    case "user_invite":
      return renderUserInvite(msg);
    case "probe":
      // Probes are drained by the queue consumer before they reach here;
      // if one slips through, fail loudly rather than silently drop.
      throw new Error(
        "renderEmail: received probe message — should have been ack'd by the consumer",
      );
    default: {
      const _exhaustive: never = msg;
      throw new Error(`renderEmail: unknown kind ${JSON.stringify(_exhaustive)}`);
    }
  }
}
