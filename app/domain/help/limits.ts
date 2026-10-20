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

/** Output cap passed to the Messages API. Thinking tokens count toward this. */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 1024;

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/** Model signals that the visitor should use the contact form. Stripped before display. */
export const ESCALATE_TOKEN = "[[ESCALATE]]";

export const TICKET_STATUSES = ["open", "replied", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SOURCES = ["chat", "contact"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];
