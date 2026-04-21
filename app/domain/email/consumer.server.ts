import type { EmailMessage } from "./types";
import { sendEmail } from "./send.server";

/**
 * EMAIL_QUEUE consumer. Called from the worker's `queue` export.
 * Cloudflare will retry failed messages per the queue's retry policy; we
 * .retry() only on retriable-looking errors, and .ack() otherwise to avoid
 * infinite loops on poison messages.
 */
export async function handleEmailQueue(
  batch: MessageBatch<EmailMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    // Status-page heartbeat: the 2-min cron enqueues { kind: 'probe' } to
    // verify the queue is accepting sends and the consumer is draining them.
    // There's no template, no recipient, and no Resend call — we just ack.
    if (msg.body.kind === "probe") {
      msg.ack();
      continue;
    }
    try {
      await sendEmail(env, msg.body);
      msg.ack();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Basic heuristic: Resend returns 4xx on bad inputs (e.g. invalid
      // address); retrying won't help. Retry everything else.
      const isClientError = /\b4\d\d\b/.test(message);
      console.error(`[email queue] send failed for kind=${msg.body.kind}: ${message}`);
      if (isClientError) {
        msg.ack(); // poison; don't retry
      } else {
        msg.retry();
      }
    }
  }
}
