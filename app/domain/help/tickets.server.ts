import type { ChatTurn } from "./guardrails";
import { subjectFromMessage } from "./guardrails";
import type { TicketSource, TicketStatus } from "./limits";

export type TicketMessageRecord = {
  id: string;
  ticketId: string;
  authorRole: "requester" | "staff";
  authorName: string | null;
  body: string;
  createdAt: Date;
};

export type TicketRecord = {
  id: string;
  viewToken: string;
  status: TicketStatus;
  source: TicketSource;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  message: string;
  transcriptJson: string | null;
  pagePath: string | null;
  signedInEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: TicketMessageRecord[];
};

export type SupportTicketStore = {
  insert(input: {
    viewToken: string;
    source: TicketSource;
    requesterName: string;
    requesterEmail: string;
    subject: string;
    message: string;
    transcriptJson: string | null;
    pagePath: string | null;
    signedInEmail: string | null;
  }): Promise<TicketRecord>;
  findById(id: string): Promise<TicketRecord | null>;
  findByViewToken(token: string): Promise<TicketRecord | null>;
  list(status: TicketStatus | null): Promise<TicketRecord[]>;
  addMessage(input: {
    ticketId: string;
    authorRole: "requester" | "staff";
    authorName: string | null;
    body: string;
    status: TicketStatus;
  }): Promise<TicketRecord | null>;
  setStatus(id: string, status: TicketStatus): Promise<TicketRecord | null>;
};

/** 48 hex chars. Unguessable link token, not a tenant id. */
export function newViewToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSupportTicket(
  store: SupportTicketStore,
  input: {
    source: TicketSource;
    name: string;
    email: string;
    message: string;
    pagePath: string | null;
    transcript: ChatTurn[] | null;
    signedInEmail: string | null;
  },
): Promise<TicketRecord> {
  return store.insert({
    viewToken: newViewToken(),
    source: input.source,
    requesterName: input.name,
    requesterEmail: input.email,
    subject: subjectFromMessage(input.message),
    message: input.message,
    transcriptJson: input.transcript ? JSON.stringify(input.transcript) : null,
    pagePath: input.pagePath,
    signedInEmail: input.signedInEmail,
  });
}

export async function replyToSupportTicket(
  store: SupportTicketStore,
  input: {
    ticketId: string;
    body: string;
    authorName: string;
    status: Extract<TicketStatus, "replied" | "closed">;
  },
): Promise<{ ok: true; ticket: TicketRecord } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Write a reply before sending." };
  if (body.length > 5_000) {
    return { ok: false, error: "Replies are limited to 5000 characters." };
  }
  const ticket = await store.addMessage({
    ticketId: input.ticketId,
    authorRole: "staff",
    authorName: input.authorName,
    body,
    status: input.status,
  });
  if (!ticket) return { ok: false, error: "That ticket no longer exists." };
  return { ok: true, ticket };
}

export async function setSupportTicketStatus(
  store: SupportTicketStore,
  ticketId: string,
  status: TicketStatus,
): Promise<{ ok: true; ticket: TicketRecord } | { ok: false; error: string }> {
  const ticket = await store.setStatus(ticketId, status);
  if (!ticket) return { ok: false, error: "That ticket no longer exists." };
  return { ok: true, ticket };
}

export function parseTranscriptJson(raw: string | null): ChatTurn[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const turns: ChatTurn[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
      turns.push({ role, content });
    }
    return turns.length > 0 ? turns : null;
  } catch {
    return null;
  }
}

type PrismaMessage = {
  id: string;
  ticketId: string;
  authorRole: string;
  authorName: string | null;
  body: string;
  createdAt: Date;
};

type PrismaTicket = {
  id: string;
  viewToken: string;
  status: string;
  source: string;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  message: string;
  transcriptJson: string | null;
  pagePath: string | null;
  signedInEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: PrismaMessage[];
};

function asStatus(value: string): TicketStatus {
  if (value === "replied" || value === "closed") return value;
  return "open";
}

function asSource(value: string): TicketSource {
  return value === "contact" ? "contact" : "chat";
}

function mapMessage(row: PrismaMessage): TicketMessageRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorRole: row.authorRole === "staff" ? "staff" : "requester",
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function mapTicket(row: PrismaTicket): TicketRecord {
  return {
    id: row.id,
    viewToken: row.viewToken,
    status: asStatus(row.status),
    source: asSource(row.source),
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    subject: row.subject,
    message: row.message,
    transcriptJson: row.transcriptJson,
    pagePath: row.pagePath,
    signedInEmail: row.signedInEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: (row.messages ?? []).map(mapMessage),
  };
}

const messageInclude = { messages: { orderBy: { createdAt: "asc" as const } } };

/**
 * Unscoped Prisma client only. Support tickets are not tenant models, so this
 * store must be built from getPrisma(context) without an orgId.
 */
type TicketWrite = {
  // Method syntax stays compatible with Prisma's generated delegates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(args: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique(args: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(args: any): Promise<any>;
};

export function createPrismaSupportStore(db: {
  supportTicket: TicketWrite;
  supportTicketMessage: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(args: any): Promise<any>;
  };
}): SupportTicketStore {
  return {
    async insert(input) {
      const row = await db.supportTicket.create({
        data: {
          viewToken: input.viewToken,
          status: "open",
          source: input.source,
          requesterName: input.requesterName,
          requesterEmail: input.requesterEmail,
          subject: input.subject,
          message: input.message,
          transcriptJson: input.transcriptJson,
          pagePath: input.pagePath,
          signedInEmail: input.signedInEmail,
          messages: {
            create: {
              authorRole: "requester",
              authorName: input.requesterName,
              body: input.message,
            },
          },
        },
        include: messageInclude,
      });
      return mapTicket(row);
    },
    async findById(id) {
      const row = await db.supportTicket.findUnique({
        where: { id },
        include: messageInclude,
      });
      return row ? mapTicket(row) : null;
    },
    async findByViewToken(token) {
      const row = await db.supportTicket.findUnique({
        where: { viewToken: token },
        include: messageInclude,
      });
      return row ? mapTicket(row) : null;
    },
    async list(status) {
      const rows = await db.supportTicket.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return rows.map((row: PrismaTicket) => mapTicket(row));
    },
    async addMessage(input) {
      const existing = await db.supportTicket.findUnique({ where: { id: input.ticketId } });
      if (!existing) return null;
      await db.supportTicketMessage.create({
        data: {
          ticketId: input.ticketId,
          authorRole: input.authorRole,
          authorName: input.authorName,
          body: input.body,
        },
      });
      const row = await db.supportTicket.update({
        where: { id: input.ticketId },
        data: { status: input.status },
        include: messageInclude,
      });
      return mapTicket(row);
    },
    async setStatus(id, status) {
      const existing = await db.supportTicket.findUnique({ where: { id } });
      if (!existing) return null;
      const row = await db.supportTicket.update({
        where: { id },
        data: { status },
        include: messageInclude,
      });
      return mapTicket(row);
    },
  };
}
