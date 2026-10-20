import { data } from "react-router";
import type { Route } from "./+types/help.ticket";
import { requireHuman } from "~/domain/help/access.server";
import { helpRateLimitKeys, parseTicketDraft } from "~/domain/help/guardrails";
import { MAX_REQUEST_CHARS, TURNSTILE_ACTION_TICKET } from "~/domain/help/limits";
import { submitPublicTicket } from "~/domain/help/submit-ticket.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

/** Turn a help-chat conversation, or a JSON contact post, into a support ticket. */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed." }, { status: 405 });
  }

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_CHARS) {
    return data({ error: "That message is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return data({ error: "Invalid request." }, { status: 400 });
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const parsed = parseTicketDraft({
    name: record.name,
    email: record.email,
    message: record.message,
    source: record.source ?? "chat",
    pagePath: record.pagePath,
    transcript: record.transcript,
    honeypot: record.company_website,
  });
  if (!parsed.ok) {
    return data({ error: parsed.error, field: parsed.field }, { status: 400 });
  }
  if (parsed.dropped) {
    return data({ ok: true as const });
  }

  const limiter = getRateLimiter(context, "RL_CONTACT");
  for (const key of helpRateLimitKeys("contact", clientIpFromRequest(request), null)) {
    const limit = await checkRateLimit({ limiter, key });
    if (!limit.ok) {
      return data(
        { error: "Too many messages. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  const human = await requireHuman({
    source: context,
    request,
    token: record.turnstileToken,
    expectedAction: TURNSTILE_ACTION_TICKET,
  });
  if (!human.ok) {
    return data({ error: human.error, code: "challenge" }, { status: 403 });
  }

  try {
    await submitPublicTicket({ context, request, draft: parsed.value });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : "error";
    console.error("[support] could not save ticket", detail);
    return data(
      { error: "We couldn't save that message. Please try again in a minute." },
      { status: 500 },
    );
  }
  return data({ ok: true as const });
}
