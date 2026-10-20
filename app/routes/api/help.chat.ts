import { data } from "react-router";
import type { Route } from "./+types/help.chat";
import { completeHelpTurn, handleHelpChat, helpChatEnv } from "~/domain/help/chat.server";
import { helpRateLimitKeys, readSessionId } from "~/domain/help/guardrails";
import { MAX_REQUEST_CHARS } from "~/domain/help/limits";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

/**
 * Help chat. Calls Anthropic server-side. Does not read the database and
 * has no tools. The only visitor facts sent to the model are the current
 * path and whether a session exists — not email, role, or school data.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed." }, { status: 405 });
  }

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_CHARS) {
    return data({ error: "That conversation is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return data({ error: "Invalid request." }, { status: 400 });
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const sessionId = readSessionId(record.sessionId);
  const limiter = getRateLimiter(context, "RL_HELP");
  for (const key of helpRateLimitKeys("help", clientIpFromRequest(request), sessionId)) {
    const limit = await checkRateLimit({ limiter, key });
    if (!limit.ok) {
      return data(
        { error: "Too many messages. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  const env = (context as { cloudflare?: { env?: { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string } } })
    .cloudflare?.env;
  const { apiKey, model } = helpChatEnv(env);
  const user = getOptionalUserFromContext(context);
  const outcome = await handleHelpChat({
    messages: record.messages,
    pagePath: record.pagePath,
    signedIn: !!user,
    apiKey,
    model,
    rateLimited: false,
    complete: (input) =>
      completeHelpTurn({
        apiKey: apiKey ?? "",
        model: input.model,
        system: input.system,
        messages: input.messages,
      }),
  });

  if (!outcome.ok) {
    return data(
      { error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) },
      { status: outcome.status },
    );
  }
  return data({
    reply: outcome.reply,
    suggestEscalation: outcome.suggestEscalation,
  });
}
