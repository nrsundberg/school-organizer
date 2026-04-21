import type { EmailMessage } from "./types";

/**
 * Enqueue an outbound email. Returns immediately — the queue consumer will
 * hand off to Resend. Safe to call from any request handler.
 *
 * The EMAIL_QUEUE binding is declared in wrangler.jsonc. If it's missing
 * (e.g. local `npm run dev` without wrangler) we log and send inline-ish
 * behavior is NOT used — we just warn. Signup still succeeds.
 */
export async function enqueueEmail(context: any, msg: EmailMessage): Promise<void> {
  const queue = context?.cloudflare?.env?.EMAIL_QUEUE as Queue<EmailMessage> | undefined;
  if (!queue) {
    // Probe messages have no `to`; every other kind does. Narrow for the log.
    const recipient = msg.kind === "probe" ? "(no recipient)" : msg.to;
    console.warn(
      `[enqueueEmail] EMAIL_QUEUE binding missing; skipping ${msg.kind} -> ${recipient}. ` +
        "Run via wrangler dev/deploy to exercise the queue.",
    );
    return;
  }
  await queue.send(msg);
}

/**
 * Bulk enqueue used by the cron. Uses sendBatch for efficiency.
 */
export async function enqueueEmails(context: any, msgs: EmailMessage[]): Promise<void> {
  if (msgs.length === 0) return;
  const queue = context?.cloudflare?.env?.EMAIL_QUEUE as Queue<EmailMessage> | undefined;
  if (!queue) {
    console.warn(`[enqueueEmails] EMAIL_QUEUE binding missing; skipping ${msgs.length} messages.`);
    return;
  }
  await queue.sendBatch(msgs.map((body) => ({ body })));
}
