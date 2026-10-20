import { getPrisma } from "~/db.server";
import { enqueueEmail } from "~/domain/email/queue.server";
import { marketingOriginFromRequest } from "~/domain/utils/host.server";
import { getSupportEmail, getSupportNotifyEmail } from "~/lib/site";
import type { TicketDraft } from "./guardrails";
import {
  createPrismaSupportStore,
  createSupportTicket,
  type TicketRecord,
} from "./tickets.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

/**
 * Persist a platform-level ticket and notify the support inbox.
 * Uses the unscoped Prisma client so the tenant extension never stamps orgId.
 */
export async function submitPublicTicket(args: {
  context: any;
  request: Request;
  draft: TicketDraft;
}): Promise<TicketRecord> {
  const user = getOptionalUserFromContext(args.context);
  const signedInEmail =
    user && typeof user.email === "string" && user.email.includes("@")
      ? user.email
      : null;
  const store = createPrismaSupportStore(getPrisma(args.context));
  const ticket = await createSupportTicket(store, {
    source: args.draft.source,
    name: args.draft.name,
    email: args.draft.email,
    message: args.draft.message,
    pagePath: args.draft.pagePath,
    transcript: args.draft.transcript,
    signedInEmail,
  });

  const origin = marketingOriginFromRequest(args.request, args.context);
  try {
    await enqueueEmail(args.context, {
      kind: "support_ticket_notice",
      to: getSupportNotifyEmail(args.context),
      ticketId: ticket.id,
      requesterName: ticket.requesterName,
      requesterEmail: ticket.requesterEmail,
      source: ticket.source,
      subject: ticket.subject,
      message: ticket.message,
      pagePath: ticket.pagePath,
      inboxUrl: `${origin}/platform/support/${ticket.id}`,
    });
  } catch (err) {
    console.error(
      "[support] ticket saved but notice email failed",
      err instanceof Error ? err.name : "error",
    );
  }
  return ticket;
}

export async function emailTicketReply(args: {
  context: any;
  request: Request;
  ticket: TicketRecord;
  replyBody: string;
}): Promise<void> {
  const origin = marketingOriginFromRequest(args.request, args.context);
  await enqueueEmail(args.context, {
    kind: "support_ticket_reply",
    to: args.ticket.requesterEmail,
    requesterName: args.ticket.requesterName,
    subject: args.ticket.subject,
    replyBody: args.replyBody,
    threadUrl: `${origin}/support/${args.ticket.viewToken}`,
    replyTo: getSupportEmail(args.context),
  });
}
