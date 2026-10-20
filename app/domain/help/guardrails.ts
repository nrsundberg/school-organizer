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
    if (typeof content !== "string") {
      return { ok: false, error: "Invalid conversation." };
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return { ok: false, error: "Messages can't be empty." };
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

export function anthropicApiKeyFromEnv(
  env: { ANTHROPIC_API_KEY?: string } | undefined,
): string | undefined {
  const fromBinding = env?.ANTHROPIC_API_KEY?.trim();
  if (fromBinding) return fromBinding;
  const fromProcess =
    typeof process !== "undefined" ? process.env.ANTHROPIC_API_KEY?.trim() : undefined;
  return fromProcess || undefined;
}
