import {
  DEFAULT_ANTHROPIC_MODEL,
  ESCALATE_TOKEN,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL_CHARS,
  MAX_EMAIL_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_NAME_CHARS,
  MAX_PAGE_PATH_CHARS,
  MAX_SUBJECT_CHARS,
  MAX_TICKET_MESSAGE_CHARS,
  TICKET_SOURCES,
  type TicketSource,
} from "./limits";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIEW_TOKEN_RE = /^[0-9a-f]{48}$/;

export function readSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return SESSION_ID_RE.test(value) ? value : null;
}

/** Relative in-app path only. Drops hosts, schemes, and whitespace. */
export function sanitizePagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > MAX_PAGE_PATH_CHARS) return null;
  if (/[\s\\]/.test(path) || path.includes("://")) return null;
  return path;
}

export function validateChatMessages(
  raw: unknown,
): { ok: true; messages: ChatTurn[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Send a message to start." };
  }
  if (raw.length > MAX_CHAT_MESSAGES) {
    return {
      ok: false,
      error: `This conversation is too long (${MAX_CHAT_MESSAGES} messages). Start a new chat or contact support.`,
    };
  }

  const messages: ChatTurn[] = [];
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid conversation." };
    }
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, error: "Invalid conversation." };
    }
    if (typeof content !== "string" || content.includes("\u0000")) {
      return { ok: false, error: "Invalid conversation." };
    }
    const trimmed = content.trim();
    if (!trimmed || trimmed.includes(ESCALATE_TOKEN)) {
      return { ok: false, error: "Invalid conversation." };
    }
    const expected = messages.length % 2 === 0 ? "user" : "assistant";
    if (role !== expected) {
      return { ok: false, error: "Invalid conversation." };
    }
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`,
      };
    }
    total += trimmed.length;
    if (total > MAX_CHAT_TOTAL_CHARS) {
      return {
        ok: false,
        error: "This conversation is too long. Start a new chat or contact support.",
      };
    }
    messages.push({ role, content: trimmed });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return { ok: false, error: "Send a message to continue." };
  }
  return { ok: true, messages };
}

export function splitEscalation(text: string): {
  reply: string;
  suggestEscalation: boolean;
} {
  const suggestEscalation = text.includes(ESCALATE_TOKEN);
  const reply = text
    .split(ESCALATE_TOKEN)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    suggestEscalation,
    reply:
      reply ||
      "I can connect you with the PickupRoster team. Use the contact form in this chat and we'll write back.",
  };
}

export type TicketDraft = {
  source: TicketSource;
  name: string;
  email: string;
  message: string;
  pagePath: string | null;
  transcript: ChatTurn[] | null;
};

export function parseTicketDraft(raw: {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  source?: unknown;
  pagePath?: unknown;
  transcript?: unknown;
  honeypot?: unknown;
}):
  | { ok: true; dropped: true }
  | { ok: true; dropped: false; value: TicketDraft }
  | { ok: false; error: string; field?: string } {
  if (typeof raw.honeypot === "string" && raw.honeypot.trim() !== "") {
    return { ok: true, dropped: true };
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required.", field: "name" };
  if (name.length > MAX_NAME_CHARS) {
    return { ok: false, error: "Name is too long.", field: "name" };
  }

  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL_CHARS) {
    return { ok: false, error: "Enter a valid email.", field: "email" };
  }

  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!message) return { ok: false, error: "Message is required.", field: "message" };
  if (message.length > MAX_TICKET_MESSAGE_CHARS) {
    return {
      ok: false,
      error: `Messages are limited to ${MAX_TICKET_MESSAGE_CHARS} characters.`,
      field: "message",
    };
  }

  const source = raw.source === "chat" || raw.source === "contact" ? raw.source : null;
  if (!source || !TICKET_SOURCES.includes(source)) {
    return { ok: false, error: "Invalid request.", field: "source" };
  }

  return {
    ok: true,
    dropped: false,
    value: {
      source,
      name,
      email,
      message,
      pagePath: sanitizePagePath(raw.pagePath),
      transcript: source === "chat" ? normalizeTranscript(raw.transcript) : null,
    },
  };
}

export function normalizeTranscript(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: ChatTurn[] = [];
  for (const item of raw.slice(0, MAX_CHAT_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!trimmed) continue;
    turns.push({ role, content: trimmed });
  }
  return turns.length > 0 ? turns : null;
}

export function subjectFromMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_SUBJECT_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_SUBJECT_CHARS - 3)}...`;
}

export function isViewToken(raw: string): boolean {
  return VIEW_TOKEN_RE.test(raw);
}

export function helpRateLimitKeys(
  prefix: string,
  ip: string,
  sessionId: string | null,
): string[] {
  const keys = [`${prefix}:ip:${ip || "unknown"}`];
  if (sessionId) keys.push(`${prefix}:ses:${sessionId}`);
  return keys;
}

const MODEL_RE = /^claude-[a-z0-9.-]{1,80}$/i;

export function anthropicModelFromEnv(env: { ANTHROPIC_MODEL?: string } | undefined): string {
  const fromBinding = env?.ANTHROPIC_MODEL?.trim();
  const fromProcess =
    typeof process !== "undefined" ? process.env.ANTHROPIC_MODEL?.trim() : undefined;
  const raw = fromBinding || fromProcess || "";
  if (raw && MODEL_RE.test(raw)) return raw;
  return DEFAULT_ANTHROPIC_MODEL;
}

/**
 * Strip paste mistakes that make Anthropic return 401: a BOM, quotes,
 * a `Bearer ` prefix, or an `x-api-key:` label. The key itself is unchanged.
 */
export function normalizeAnthropicApiKey(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  let value = raw.replace(/^\uFEFF/, "").trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/^Bearer\s+/i, "").replace(/^x-api-key\s*:\s*/i, "").trim();
  return value.length > 0 ? value : undefined;
}

export function anthropicApiKeyFromEnv(
  env: { ANTHROPIC_API_KEY?: string } | undefined,
): string | undefined {
  const fromBinding = normalizeAnthropicApiKey(env?.ANTHROPIC_API_KEY);
  if (fromBinding) return fromBinding;
  const fromProcess =
    typeof process !== "undefined"
      ? normalizeAnthropicApiKey(process.env.ANTHROPIC_API_KEY)
      : undefined;
  return fromProcess;
}

/** Unset means the chat is on. `0`, `false`, `off`, or `no` turns it off. */
export function helpChatEnabled(source: unknown): boolean {
  const record = source as {
    HELP_CHAT_ENABLED?: string;
    cloudflare?: { env?: { HELP_CHAT_ENABLED?: string } };
  };
  const raw =
    record?.cloudflare?.env?.HELP_CHAT_ENABLED ??
    record?.HELP_CHAT_ENABLED ??
    (typeof process !== "undefined" ? process.env.HELP_CHAT_ENABLED : undefined);
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return true;
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

/**
 * Hosts the help widget may mint a Turnstile token on: marketing hosts,
 * the apex, and tenant subdomains of PUBLIC_ROOT_DOMAIN.
 */
export function helpHostAllowed(host: string, source: unknown): boolean {
  const hostname = host.trim().toLowerCase();
  if (!hostname || hostname.includes("..")) return false;
  const record = source as {
    MARKETING_HOSTS?: string;
    PUBLIC_ROOT_DOMAIN?: string;
    cloudflare?: { env?: { MARKETING_HOSTS?: string; PUBLIC_ROOT_DOMAIN?: string } };
  };
  const env = record?.cloudflare?.env ?? record;
  const marketing = (env?.MARKETING_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (marketing.includes(hostname)) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  const root = (env?.PUBLIC_ROOT_DOMAIN ?? "").trim().toLowerCase();
  if (!root || root === "localhost" || root.endsWith(".localhost")) return false;
  return hostname === root || hostname === `www.${root}` || hostname.endsWith(`.${root}`);
}
