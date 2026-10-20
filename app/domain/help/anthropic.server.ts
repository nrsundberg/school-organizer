import { ANTHROPIC_MAX_OUTPUT_TOKENS } from "./limits";
import type { ChatTurn } from "./guardrails";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicCompletion =
  | { ok: true; text: string; refused: boolean }
  | { ok: false; error: string };

const UNAVAILABLE = "The help assistant is unavailable right now. Use the contact form and we'll write back.";

type ContentBlock = { type?: string; text?: string };

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim()
    .slice(0, 4_000);
}

function redactSecrets(value: string): string {
  return value.replace(/sk-ant-[A-Za-z0-9_+/=\-]{8,}/g, "sk-ant-redacted").slice(0, 300);
}

function anthropicErrorDetails(payload: unknown): { type: string; message: string } {
  const error = (payload as { error?: { type?: unknown; message?: unknown } } | null)?.error;
  const type = typeof error?.type === "string" ? error.type : "unknown";
  const message = typeof error?.message === "string" ? redactSecrets(error.message) : "";
  return { type, message };
}

/**
 * One non-streaming Messages API call. No tools. Effort is low so a help
 * reply stays cheap. Thinking blocks are dropped; only text is returned.
 */
export async function completeWithAnthropic(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
  fetchImpl?: typeof fetch;
}): Promise<AnthropicCompletion> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
        // Haiku 5.5 thinks by default, and thinking tokens spend max_tokens
        // before any text. This bot only needs a short reply.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: args.system,
        messages: args.messages.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error(
      "[help-chat] anthropic request failed",
      err instanceof Error ? err.name : "error",
    );
    return { ok: false, error: UNAVAILABLE };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }

  if (!response.ok) {
    const details = anthropicErrorDetails(payload);
    const prefixOk = args.apiKey.startsWith("sk-ant-");
    console.error(
      "[help-chat] anthropic status",
      response.status,
      details.type,
      details.message,
      "keyLength",
      args.apiKey.length,
      "keyPrefixOk",
      prefixOk,
    );
    return { ok: false, error: UNAVAILABLE };
  }

  const stop = (payload as { stop_reason?: unknown }).stop_reason;
  const content = (payload as { content?: unknown }).content;
  const text = extractText(content);
  if (stop === "refusal") {
    return {
      ok: true,
      refused: true,
      text:
        text ||
        "I can only help with PickupRoster — signup, pricing, the free trial, and finding pages in the app.",
    };
  }
  if (!text) {
    const types = Array.isArray(content)
      ? content
          .map((block) =>
            block && typeof block === "object" && "type" in block ? String(block.type) : "?",
          )
          .join(",")
      : "none";
    console.error("[help-chat] empty text", String(stop), types);
    return { ok: false, error: UNAVAILABLE };
  }
  return { ok: true, text, refused: false };
}
