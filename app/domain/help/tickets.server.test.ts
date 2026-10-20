import test from "node:test";
import assert from "node:assert/strict";
import {
  createPrismaSupportStore,
  createSupportTicket,
  replyToSupportTicket,
  setSupportTicketStatus,
  type SupportTicketStore,
  type TicketRecord,
} from "./tickets.server";

function memoryStore(): SupportTicketStore & { rows: TicketRecord[] } {
  const rows: TicketRecord[] = [];
  let seq = 0;
  const nextId = () => `id_${++seq}`;

  function clone(row: TicketRecord): TicketRecord {
    return { ...row, messages: row.messages.map((message) => ({ ...message })) };
  }

  return {
    rows,
    async insert(input) {
      const now = new Date("2026-10-20T12:00:00.000Z");
      const id = nextId();
      const row: TicketRecord = {
        id,
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
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: nextId(),
            ticketId: id,
            authorRole: "requester",
            authorName: input.requesterName,
            body: input.message,
            createdAt: now,
          },
        ],
      };
      rows.push(row);
      return clone(row);
    },
    async findById(id) {
      const row = rows.find((item) => item.id === id);
      return row ? clone(row) : null;
    },
    async findByViewToken(token) {
      const row = rows.find((item) => item.viewToken === token);
      return row ? clone(row) : null;
    },
    async list(status) {
      return rows
        .filter((row) => (status ? row.status === status : true))
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(clone);
    },
    async addMessage(input) {
      const row = rows.find((item) => item.id === input.ticketId);
      if (!row) return null;
      row.messages.push({
        id: nextId(),
        ticketId: row.id,
        authorRole: input.authorRole,
        authorName: input.authorName,
        body: input.body,
        createdAt: new Date("2026-10-20T13:00:00.000Z"),
      });
      row.status = input.status;
      row.updatedAt = new Date("2026-10-20T13:00:00.000Z");
      return clone(row);
    },
    async setStatus(id, status) {
      const row = rows.find((item) => item.id === id);
      if (!row) return null;
      row.status = status;
      return clone(row);
    },
  };
}

test("creating a ticket stores an open thread, transcript, and view token", async () => {
  const store = memoryStore();
  const ticket = await createSupportTicket(store, {
    source: "chat",
    name: "Ada Lovelace",
    email: "ada@school.edu",
    message: "Where do I manage homerooms?",
    pagePath: "/homerooms",
    transcript: [
      { role: "user", content: "Where do I manage homerooms?" },
      { role: "assistant", content: "Open Classrooms." },
    ],
    signedInEmail: "ada@school.edu",
  });

  assert.equal(ticket.status, "open");
  assert.equal(ticket.source, "chat");
  assert.equal(ticket.pagePath, "/homerooms");
  assert.equal(ticket.signedInEmail, "ada@school.edu");
  assert.match(ticket.viewToken, /^[0-9a-f]{48}$/);
  assert.equal(ticket.messages.length, 1);
  assert.equal(ticket.messages[0]?.authorRole, "requester");
  assert.equal(ticket.messages[0]?.body, "Where do I manage homerooms?");
  const transcript = JSON.parse(ticket.transcriptJson ?? "[]") as { role: string }[];
  assert.equal(transcript.length, 2);
  assert.equal(store.rows.length, 1);
});

test("a staff reply is appended and the ticket becomes replied or closed", async () => {
  const store = memoryStore();
  const created = await createSupportTicket(store, {
    source: "contact",
    name: "Grace",
    email: "grace@school.edu",
    message: "Question about the trial.",
    pagePath: null,
    transcript: null,
    signedInEmail: null,
  });

  const replied = await replyToSupportTicket(store, {
    ticketId: created.id,
    body: "The trial is 30 days and does not need a card.",
    authorName: "Noah",
    status: "replied",
  });
  assert.equal(replied.ok, true);
  if (replied.ok) {
    assert.equal(replied.ticket.status, "replied");
    assert.equal(replied.ticket.messages.length, 2);
    assert.equal(replied.ticket.messages[1]?.authorRole, "staff");
    assert.equal(replied.ticket.messages[1]?.authorName, "Noah");
  }

  const closed = await replyToSupportTicket(store, {
    ticketId: created.id,
    body: "Closing this out.",
    authorName: "Noah",
    status: "closed",
  });
  assert.equal(closed.ok, true);
  if (closed.ok) assert.equal(closed.ticket.status, "closed");
});

test("reply and status changes miss when the ticket is gone", async () => {
  const store = memoryStore();
  const missing = await replyToSupportTicket(store, {
    ticketId: "missing",
    body: "hello",
    authorName: "Noah",
    status: "replied",
  });
  assert.deepEqual(missing, { ok: false, error: "That ticket no longer exists." });

  const blank = await replyToSupportTicket(store, {
    ticketId: "missing",
    body: "   ",
    authorName: "Noah",
    status: "replied",
  });
  assert.equal(blank.ok, false);

  const status = await setSupportTicketStatus(store, "missing", "closed");
  assert.equal(status.ok, false);
});

test("prisma store writes an unscoped open ticket and lists newest first", async () => {
  const calls: unknown[] = [];
  const now = new Date("2026-10-20T15:00:00.000Z");
  const older = new Date("2026-10-20T14:00:00.000Z");
  const row = {
    id: "tkt_1",
    viewToken: "a".repeat(48),
    status: "open",
    source: "contact",
    requesterName: "Ada",
    requesterEmail: "ada@school.edu",
    subject: "Hello",
    message: "Hello",
    transcriptJson: null,
    pagePath: "/contact",
    signedInEmail: null,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: "msg_1",
        ticketId: "tkt_1",
        authorRole: "requester",
        authorName: "Ada",
        body: "Hello",
        createdAt: now,
      },
    ],
  };

  const db = {
    supportTicket: {
      async create(args: unknown) {
        calls.push(args);
        return row;
      },
      async findUnique() {
        return row;
      },
      async findMany(args: unknown) {
        calls.push(args);
        return [
          row,
          { ...row, id: "tkt_0", createdAt: older, messages: [] },
        ];
      },
      async update(args: unknown) {
        calls.push(args);
        return { ...row, status: "replied" };
      },
    },
    supportTicketMessage: {
      async create(args: unknown) {
        calls.push(args);
        return row.messages[0]!;
      },
    },
  };

  const store = createPrismaSupportStore(db);
  const created = await store.insert({
    viewToken: "b".repeat(48),
    source: "contact",
    requesterName: "Ada",
    requesterEmail: "ada@school.edu",
    subject: "Hello",
    message: "Hello",
    transcriptJson: null,
    pagePath: "/contact",
    signedInEmail: null,
  });
  assert.equal(created.status, "open");
  const createArgs = calls[0] as { data: { status: string; orgId?: string; messages: { create: { authorRole: string } } } };
  assert.equal(createArgs.data.status, "open");
  assert.equal(createArgs.data.orgId, undefined);
  assert.equal(createArgs.data.messages.create.authorRole, "requester");

  const listed = await store.list(null);
  const listArgs = calls[1] as { orderBy: { createdAt: string }; where?: unknown };
  assert.deepEqual(listArgs.orderBy, { createdAt: "desc" });
  assert.equal(listArgs.where, undefined);
  assert.equal(listed[0]?.id, "tkt_1");

  const replied = await store.addMessage({
    ticketId: "tkt_1",
    authorRole: "staff",
    authorName: "Noah",
    body: "On it.",
    status: "replied",
  });
  assert.equal(replied?.status, "replied");
  const updateArgs = calls[3] as { data: { status: string; orgId?: string } };
  assert.equal(updateArgs.data.status, "replied");
  assert.equal(updateArgs.data.orgId, undefined);
});
