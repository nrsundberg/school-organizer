/** Single chat turn. Keeps a runaway prompt from burning the model budget. */
export const MAX_MESSAGE_CHARS = 2_000;

/** User + assistant turns accepted in one request. */
export const MAX_CHAT_MESSAGES = 12;

/** Sum of turn lengths. Caps cost even when each turn is under the per-message cap. */
export const MAX_CHAT_TOTAL_CHARS = 8_000;

/** Raw JSON body for /api/help/chat and /api/help/ticket. */
export const MAX_REQUEST_CHARS = 48_000;

export const MAX_TICKET_MESSAGE_CHARS = 5_000;
export const MAX_NAME_CHARS = 120;
export const MAX_EMAIL_CHARS = 254;
export const MAX_SUBJECT_CHARS = 140;
export const MAX_PAGE_PATH_CHARS = 200;

/**
 * Output cap passed to the Messages API. Thinking is disabled for this bot,
 * so the whole budget is the visible reply.
 */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 512;

/** Signed chat grant lifetime. A new grant is issued on each accepted turn. */
export const HELP_SESSION_TTL_MS = 30 * 60 * 1000;

/** UTC-day caps. The rate-limit binding only allows a 10s or 60s window. */
export const DAILY_IP_MESSAGE_CAP = 30;
export const DAILY_SESSION_MESSAGE_CAP = 20;

export const TURNSTILE_ACTION_CHAT = "help_chat";
export const TURNSTILE_ACTION_TICKET = "help_ticket";
export const TURNSTILE_ACTION_CONTACT = "contact";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/** Model signals that the visitor should use the contact form. Stripped before display. */
export const ESCALATE_TOKEN = "[[ESCALATE]]";

export const TICKET_STATUSES = ["open", "replied", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SOURCES = ["chat", "contact"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];
