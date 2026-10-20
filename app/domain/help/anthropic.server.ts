import { normalizeAnthropicApiKey, type ChatTurn } from "./guardrails";
import { ANTHROPIC_MAX_OUTPUT_TOKENS } from "./limits";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 20_000;
const TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/i;

export type HelpUpstreamCode =
  | "upstream_401"
  | "upstream_403"
  | "upstream_404"
  | "upstream_429"
  | "upstream_4xx"
  | "upstream_5xx"
  | "upstream_timeout"
  | "upstream_fetch"
  | "upstream_bad_json"
  | "upstream_empty";

export type AnthropicCompletion =
  | { ok: true; text: string; refused: boolean }
  | { ok: false; error: string; code: HelpUpstreamCode; upstreamType?: string };

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
  const type = typeof error?.type === "string" ? error.type : "";
  const message = typeof error?.message === "string" ? redactSecrets(error.message) : "";
  return { type, message };
}

export function classifyAnthropicStatus(status: number): HelpUpstreamCode {
  if (status === 401) return "upstream_401";
  if (status === 403) return "upstream_403";
  if (status === 404) return "upstream_404";
  if (status === 408 || status === 429) return status === 408 ? "upstream_timeout" : "upstream_429";
  if (status >= 500 && status <= 599) return "upstream_5xx";
  if (status >= 400 && status <= 499) return "upstream_4xx";
  return "upstream_fetch";
}

function safeUpstreamType(raw: string): string | undefined {
  const value = raw.trim();
  return TYPE_RE.test(value) ? value : undefined;
}

function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  return name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message);
}

function requestSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function fail(
  code: HelpUpstreamCode,
  upstreamType: string | undefined,
  log: string,
): AnthropicCompletion {
  console.error(`[help-chat] anthropic ${log}`);
  return upstreamType
    ? { ok: false, error: UNAVAILABLE, code, upstreamType }
    : { ok: false, error: UNAVAILABLE, code };
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
  const apiKey = normalizeAnthropicApiKey(args.apiKey);
  if (!apiKey) {
    return fail("upstream_fetch", undefined, "code=upstream_fetch reason=empty_key");
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
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
      signal: requestSignal(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const code = isTimeout(err) ? "upstream_timeout" : "upstream_fetch";
    const name = err instanceof Error ? err.name : "error";
    return fail(code, undefined, `code=${code} name=${name}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const code = response.ok ? "upstream_bad_json" : classifyAnthropicStatus(response.status);
    return fail(code, undefined, `code=${code} status=${response.status} reason=bad_json`);
  }

  if (!response.ok) {
    const details = anthropicErrorDetails(payload);
    const code = classifyAnthropicStatus(response.status);
    const upstreamType = safeUpstreamType(details.type);
    const prefixOk = apiKey.startsWith("sk-ant-");
    return fail(
      code,
      upstreamType,
      `code=${code} upstreamType=${upstreamType ?? ""} status=${response.status} keyLength=${apiKey.length} keyPrefixOk=${prefixOk} message=${details.message}`,
    );
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
    return fail("upstream_empty", undefined, `code=upstream_empty stop=${String(stop)} types=${types}`);
  }
  return { ok: true, text, refused: false };
}
