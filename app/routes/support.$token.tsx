import { isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/support.$token";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { isViewToken } from "~/domain/help/guardrails";
import {
  createPrismaSupportStore,
  parseTranscriptJson,
} from "~/domain/help/tickets.server";
import { getPrisma } from "~/db.server";

function formatWhen(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function meta() {
  return [{ title: "Support conversation — PickupRoster" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const token = params.token ?? "";
  if (!isViewToken(token)) {
    throw new Response("Not found", { status: 404 });
  }
  const ticket = await createPrismaSupportStore(getPrisma(context)).findByViewToken(token);
  if (!ticket) throw new Response("Not found", { status: 404 });
  return {
    subject: ticket.subject,
    status: ticket.status,
    requesterName: ticket.requesterName,
    createdAt: ticket.createdAt.toISOString(),
    messages: ticket.messages.map((message) => ({
      id: message.id,
      authorRole: message.authorRole,
      authorName: message.authorName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    })),
    transcript: parseTranscriptJson(ticket.transcriptJson),
  };
}

export function ErrorBoundary() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-xl px-4 py-14">
        <h1 className="text-3xl font-extrabold">
          {missing ? "We couldn't find that conversation" : "Something went wrong"}
        </h1>
        <p className="mt-3 text-white/70">
          {missing
            ? "The link may be incomplete. Check the email from PickupRoster support."
            : "Please refresh and try the link again."}
        </p>
      </div>
    </div>
  );
}

export default function SupportThread({ loaderData }: Route.ComponentProps) {
  const statusLabel =
    loaderData.status === "closed"
      ? "Closed"
      : loaderData.status === "replied"
        ? "Replied"
        : "Open";

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-14">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#E9D500]">{statusLabel}</p>
        <h1 className="mt-2 text-3xl font-extrabold">{loaderData.subject}</h1>
        <p className="mt-2 text-sm text-white/60">
          {loaderData.requesterName} · opened {formatWhen(new Date(loaderData.createdAt))}
        </p>
        <p className="mt-4 text-sm text-white/60">
          Replies from PickupRoster show up here and in your email.
        </p>

        <ol className="mt-8 space-y-4">
          {loaderData.messages.map((message) => (
            <li key={message.id} className="rounded-2xl border border-white/10 bg-[#151a1a] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
                {message.authorRole === "staff"
                  ? message.authorName || "PickupRoster"
                  : message.authorName || "You"}
                {" · "}
                {formatWhen(new Date(message.createdAt))}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                {message.body}
              </p>
            </li>
          ))}
        </ol>

        {loaderData.transcript && loaderData.transcript.length > 0 ? (
          <details className="mt-8 rounded-2xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-medium text-white/80">
              Help chat transcript
            </summary>
            <ol className="mt-4 space-y-3">
              {loaderData.transcript.map((turn, index) => (
                <li key={index} className="text-sm text-white/75">
                  <span className="font-semibold text-white/50">
                    {turn.role === "assistant" ? "Help" : "You"}:{" "}
                  </span>
                  {turn.content}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  );
}
