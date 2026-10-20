import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_IP_MESSAGE_CAP, DAILY_SESSION_MESSAGE_CAP } from "./limits";
import { consumeHelpQuota, type HelpQuotaDb } from "./quota.server";

function memoryDb(): HelpQuotaDb & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    helpChatQuota: {
      async upsert({ where, create, update }) {
        const key = `${where.subject_day.subject}|${where.subject_day.day}`;
        const prev = rows.get(key) ?? 0;
        const count = prev === 0 ? create.count : prev + update.count.increment;
        rows.set(key, count);
        return { count };
      },
    },
  };
}

test("daily quota counts IP and session and stops at the cap", async () => {
  const db = memoryDb();
  const now = new Date("2026-10-20T12:00:00.000Z");
  for (let i = 0; i < DAILY_SESSION_MESSAGE_CAP; i += 1) {
    const result = await consumeHelpQuota({
      db,
      environment: "staging",
      ip: "203.0.113.4",
      sessionId: "11111111-2222-4333-8444-555555555555",
      now,
    });
    assert.equal(result.ok, true);
  }
  const blocked = await consumeHelpQuota({
    db,
    environment: "staging",
    ip: "203.0.113.4",
    sessionId: "11111111-2222-4333-8444-555555555555",
    now,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /today/i);

  const otherSession = await consumeHelpQuota({
    db,
    environment: "staging",
    ip: "203.0.113.9",
    sessionId: "22222222-2222-4333-8444-555555555555",
    now,
  });
  assert.equal(otherSession.ok, true);
  assert.ok(DAILY_IP_MESSAGE_CAP >= DAILY_SESSION_MESSAGE_CAP);
});

test("daily quota fails closed in staging when the counter is missing", async () => {
  const missing = await consumeHelpQuota({
    db: undefined,
    environment: "staging",
    ip: "203.0.113.4",
    sessionId: "11111111-2222-4333-8444-555555555555",
  });
  assert.equal(missing.ok, false);

  const dev = await consumeHelpQuota({
    db: undefined,
    environment: "development",
    ip: "127.0.0.1",
    sessionId: "11111111-2222-4333-8444-555555555555",
  });
  assert.equal(dev.ok, true);
});
