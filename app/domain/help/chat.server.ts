import { completeWithAnthropic, type AnthropicCompletion } from "./anthropic.server";
import {
  anthropicApiKeyFromEnv,
  anthropicModelFromEnv,
  sanitizePagePath,
  splitEscalation,
  validateChatMessages,
  type ChatTurn,
} from "./guardrails";
import { buildSystemPrompt } from "./knowledge";

export type HelpChatSuccess = {
  ok: true;
  reply: string;
  suggestEscalation: boolean;
};

export type HelpChatFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
  upstreamType?: string;
};

export async function handleHelpChat(args: {
  messages: unknown;
  pagePath: unknown;
  signedIn: boolean;
  apiKey: string | undefined;
  model: string;
  rateLimited: boolean;
  complete: (input: {
    system: string;
    messages: ChatTurn[];
    model: string;
  }) => Promise<AnthropicCompletion>;
}): Promise<HelpChatSuccess | HelpChatFailure> {
  if (args.rateLimited) {
    return {
      ok: false,
      status: 429,
      error: "Too many messages. Please wait a minute and try again.",
    };
  }

  const validated = validateChatMessages(args.messages);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }

  if (!args.apiKey) {
    return {
      ok: false,
      status: 503,
      code: "unconfigured",
      error:
        "Help chat isn't configured in this environment. Use the contact form and we'll write back.",
    };
  }

  const system = buildSystemPrompt({
    pagePath: sanitizePagePath(args.pagePath),
    signedIn: args.signedIn,
  });
  const result = await args.complete({
    system,
    messages: validated.messages,
    model: args.model,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 502,
      error: result.error,
      code: result.code,
      ...(result.upstreamType ? { upstreamType: result.upstreamType } : {}),
    };
  }

  const split = splitEscalation(result.text);
  return {
    ok: true,
    reply: split.reply,
    suggestEscalation: split.suggestEscalation || result.refused,
  };
}

export function helpChatEnv(env: {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
} | undefined): { apiKey: string | undefined; model: string } {
  return {
    apiKey: anthropicApiKeyFromEnv(env),
    model: anthropicModelFromEnv(env),
  };
}

/** Used by the route so tests can substitute `complete`. */
export async function completeHelpTurn(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
}): Promise<AnthropicCompletion> {
  return completeWithAnthropic(args);
}
