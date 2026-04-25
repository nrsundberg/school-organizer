import { Resend } from "resend";
import { DEFAULT_FROM, type SendableEmailMessage } from "./types";
import { renderEmail } from "./templates";

/**
 * Low-level send: given a fully-typed EmailMessage, render it and hand it to
 * Resend. Called from the EMAIL_QUEUE consumer — do not call from request
 * handlers. Request handlers should enqueue via `enqueueEmail`.
 *
 * The consumer filters out probe messages before calling this; the narrower
 * `SendableEmailMessage` type makes that contract explicit.
 */
export async function sendEmail(env: Env, msg: SendableEmailMessage): Promise<void> {
  const apiKey = (env as any).RESEND_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error(
      "sendEmail: RESEND_API_KEY is not set. Add it as a Cloudflare Worker secret: `wrangler secret put RESEND_API_KEY`.",
    );
  }

  const rendered = await renderEmail(msg);
  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to: msg.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // Per-template Reply-To override (e.g. welcome routes replies to Noah's
    // personal inbox). When undefined, Resend defaults to the From address.
    ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
    // Tag so we can segment by email kind in Resend's dashboard/webhooks.
    tags: [
      { name: "kind", value: msg.kind },
    ],
  });

  if (error) {
    // Let the queue consumer retry via Cloudflare's default retry policy.
    throw new Error(`Resend send failed (${msg.kind} -> ${msg.to}): ${error.name}: ${error.message}`);
  }
}
