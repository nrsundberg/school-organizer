import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/support.$ticketId";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { emailTicketReply } from "~/domain/help/submit-ticket.server";
import {
  createPrismaSupportStore,
  parseTranscriptJson,
  replyToSupportTicket,
  setSupportTicketStatus,
} from "~/domain/help/tickets.server";
import { getPrisma } from "~/db.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Ticket" }];

function formatWhen(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const ticket = await createPrismaSupportStore(getPrisma(context)).findById(params.ticketId ?? "");
  if (!ticket) throw new Response("Not found", { status: 404 });
  return {
    ticket,
    transcript: parseTranscriptJson(ticket.transcriptJson),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const admin = await requirePlatformAdmin(context);
  const ticketId = params.ticketId ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const store = createPrismaSupportStore(getPrisma(context));
  const authorName = admin.name?.trim() || admin.email || "PickupRoster support";

  if (intent === "close" || intent === "reopen") {
    const result = await setSupportTicketStatus(
      store,
      ticketId,
      intent === "close" ? "closed" : "open",
    );
    if (!result.ok) return data({ error: result.error }, { status: 404 });
    return data({ notice: intent === "close" ? "Ticket closed." : "Ticket reopened." });
  }

  if (intent !== "reply" && intent !== "reply-close") {
    return data({ error: "Unknown action." }, { status: 400 });
  }

  const result = await replyToSupportTicket(store, {
    ticketId,
    body: String(form.get("body") ?? ""),
    authorName,
    status: intent === "reply-close" ? "closed" : "replied",
  });
  if (!result.ok) {
    const status = result.error.includes("no longer") ? 404 : 400;
    return data({ error: result.error }, { status });
  }

  try {
    await emailTicketReply({
      context,
      request,
      ticket: result.ticket,
      replyBody: String(form.get("body") ?? "").trim(),
    });
  } catch (err) {
    console.error("[support] reply saved but email failed", err instanceof Error ? err.name : "error");
    return data({
      notice: "Reply saved. The email did not send — check RESEND_API_KEY and the email queue.",
    });
  }
  return data({
    notice: intent === "reply-close" ? "Reply sent and ticket closed." : "Reply sent.",
  });
}

export default function PlatformTicket({ loaderData }: Route.ComponentProps) {
  const { ticket, transcript } = loaderData;
  const result = useActionData<typeof action>();

  return (
    <div className="space-y-6">
      <div>
        <Link to="/platform/support" className="text-sm text-[#E9D500] underline hover:text-[#f5e047]">
          All tickets
        </Link>
        <h1 className="mt-2 text-xl font-bold">{ticket.subject}</h1>
        <p className="mt-1 text-sm text-white/60">
          {ticket.status} · {ticket.source} · {ticket.requesterName} · {ticket.requesterEmail}
        </p>
        <p className="mt-1 text-xs text-white/50">
          Opened {formatWhen(ticket.createdAt)}
          {ticket.pagePath ? ` · page ${ticket.pagePath}` : ""}
          {ticket.signedInEmail ? ` · signed in as ${ticket.signedInEmail}` : ""}
        </p>
      </div>

      {result && "error" in result && result.error ? (
        <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-200" role="alert">
          {result.error}
        </p>
      ) : null}
      {result && "notice" in result && result.notice ? (
        <p className="rounded-lg border border-[#E9D500]/40 bg-[#E9D500]/10 px-3 py-2 text-sm text-[#E9D500]" role="status">
          {result.notice}
        </p>
      ) : null}

      <ol className="space-y-3">
        {ticket.messages.map((message) => (
          <li key={message.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              {message.authorRole === "staff" ? message.authorName || "Staff" : message.authorName || "Requester"}
              {" · "}
              {formatWhen(message.createdAt)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85">{message.body}</p>
          </li>
        ))}
      </ol>

      {transcript && transcript.length > 0 ? (
        <details className="rounded-xl border border-white/10 p-4">
          <summary className="cursor-pointer text-sm font-medium text-white/80">Chat transcript</summary>
          <ol className="mt-3 space-y-2">
            {transcript.map((turn, index) => (
              <li key={index} className="text-sm text-white/75">
                <span className="font-semibold text-white/50">
                  {turn.role === "assistant" ? "Help" : "Visitor"}:{" "}
                </span>
                {turn.content}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <Form method="post" className="space-y-3 rounded-xl border border-white/10 p-4">
        <label className="block text-sm font-medium text-white/80">
          Reply
          <textarea
            name="body"
            rows={5}
            maxLength={5000}
            required
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="intent"
            value="reply"
            className="rounded-lg bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B]"
          >
            Send reply
          </button>
          <button
            type="submit"
            name="intent"
            value="reply-close"
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/80"
          >
            Send and close
          </button>
        </div>
        <p className="text-xs text-white/50">
          This emails {ticket.requesterEmail} and adds the reply to their thread.
        </p>
      </Form>

      <Form method="post">
        {ticket.status === "closed" ? (
          <button
            type="submit"
            name="intent"
            value="reopen"
            className="text-sm text-white/70 underline"
          >
            Reopen ticket
          </button>
        ) : (
          <button
            type="submit"
            name="intent"
            value="close"
            className="text-sm text-white/70 underline"
          >
            Close without a reply
          </button>
        )}
      </Form>
    </div>
  );
}
