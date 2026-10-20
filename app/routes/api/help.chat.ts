import { data } from "react-router";
import type { Route } from "./+types/help.chat";
import { authorizeHelpChat } from "~/domain/help/access.server";
import { verifyTurnstile } from "~/domain/booking/turnstile";
import { completeHelpTurn, handleHelpChat, helpChatEnv } from "~/domain/help/chat.server";
import { helpChatEnabled, helpHostAllowed, helpRateLimitKeys, readSessionId } from "~/domain/help/guardrails";
import { MAX_REQUEST_CHARS, TURNSTILE_ACTION_CHAT } from "~/domain/help/limits";
import { consumeHelpQuotaFromContext } from "~/domain/help/quota.server";
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
  if (!helpChatEnabled(context)) {
    return data(
      {
        error: "Help chat is turned off right now. Use the contact form and we'll write back.",
        code: "disabled",
      },
      { status: 503 },
    );
  }
  if (!sessionId) {
    return data({ error: "Refresh the page and try again." }, { status: 400 });
  }

  const limiter = getRateLimiter(context, "RL_HELP");
  const ip = clientIpFromRequest(request);
  for (const key of helpRateLimitKeys("help", ip, sessionId)) {
    const limit = await checkRateLimit({ limiter, key });
    if (!limit.ok) {
      return data(
        { error: "Too many messages. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  const env = (
    context as {
      cloudflare?: {
        env?: {
          ANTHROPIC_API_KEY?: string;
          ANTHROPIC_MODEL?: string;
          TURNSTILE_SECRET_KEY?: string;
          ENVIRONMENT?: string;
        };
      };
    }
  ).cloudflare?.env;
  const host = new URL(request.url).hostname.toLowerCase();
  const turnstileRequired = Boolean(env?.TURNSTILE_SECRET_KEY?.trim()) ||
    env?.ENVIRONMENT === "production" ||
    env?.ENVIRONMENT === "staging";
  const access = await authorizeHelpChat({
    source: context,
    sessionId,
    grant: record.sessionGrant,
    turnstileToken: record.turnstileToken,
    turnstileRequired,
    verify: async (token) => {
      if (!helpHostAllowed(host, context)) return { ok: false, error: "turnstile" };
      return verifyTurnstile({
        secret: env?.TURNSTILE_SECRET_KEY,
        token,
        remoteIp: ip,
        expectedAction: TURNSTILE_ACTION_CHAT,
        expectedHostnames: [host],
        environment: env?.ENVIRONMENT ?? "development",
      });
    },
  });
  if (!access.ok) {
    return data({ error: access.error, code: access.code }, { status: access.status });
  }

  const quota = await consumeHelpQuotaFromContext({ context, ip, sessionId });
  if (!quota.ok) {
    return data({ error: quota.error, code: "quota" }, { status: 429 });
  }

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
      {
        error: outcome.error,
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.upstreamType ? { upstreamType: outcome.upstreamType } : {}),
      },
      { status: outcome.status },
    );
  }
  return data({
    reply: outcome.reply,
    suggestEscalation: outcome.suggestEscalation,
    sessionGrant: access.grant,
  });
}
