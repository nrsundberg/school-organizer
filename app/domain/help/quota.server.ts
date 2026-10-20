import { getPrisma } from "~/db.server";
import { DAILY_IP_MESSAGE_CAP, DAILY_SESSION_MESSAGE_CAP } from "./limits";

const DAILY_LIMIT_ERROR =
  "You've reached today's help chat limit. Use the contact form and we'll write back.";
const UNAVAILABLE =
  "The help assistant is unavailable right now. Use the contact form and we'll write back.";

type QuotaRow = { count: number };

export type HelpQuotaDb = {
  helpChatQuota: {
    upsert(args: {
      where: { subject_day: { subject: string; day: string } };
      create: { subject: string; day: string; count: number };
      update: { count: { increment: number } };
    }): Promise<QuotaRow>;
  };
};

function environmentName(source: unknown): string {
  const record = source as {
    ENVIRONMENT?: string;
    cloudflare?: { env?: { ENVIRONMENT?: string } };
  };
  const raw =
    record?.cloudflare?.env?.ENVIRONMENT ??
    record?.ENVIRONMENT ??
    (typeof process !== "undefined" ? process.env.ENVIRONMENT : undefined);
  return (typeof raw === "string" ? raw : "development").trim().toLowerCase();
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Count one chat turn against the UTC-day IP and session caps.
 * The table is platform-level (no orgId). Local dev without the table allows
 * the turn; staging and production fail closed.
 */
export async function consumeHelpQuota(args: {
  db: HelpQuotaDb | undefined;
  environment: string;
  ip: string;
  sessionId: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const environment = args.environment.toLowerCase();
  if (!args.db) {
    return environment === "production" || environment === "staging"
      ? { ok: false, error: UNAVAILABLE }
      : { ok: true };
  }
  const day = utcDay(args.now ?? new Date());
  const subjects: Array<{ subject: string; limit: number }> = [
    { subject: `ip:${args.ip || "unknown"}`, limit: DAILY_IP_MESSAGE_CAP },
    { subject: `ses:${args.sessionId}`, limit: DAILY_SESSION_MESSAGE_CAP },
  ];
  try {
    for (const item of subjects) {
      const row = await args.db.helpChatQuota.upsert({
        where: { subject_day: { subject: item.subject, day } },
        create: { subject: item.subject, day, count: 1 },
        update: { count: { increment: 1 } },
      });
      if (row.count > item.limit) return { ok: false, error: DAILY_LIMIT_ERROR };
    }
    return { ok: true };
  } catch (err) {
    console.error("[help-chat] quota", err instanceof Error ? err.name : "error");
    if (environment === "production" || environment === "staging") {
      return { ok: false, error: UNAVAILABLE };
    }
    return { ok: true };
  }
}

export async function consumeHelpQuotaFromContext(args: {
  context: unknown;
  ip: string;
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let db: HelpQuotaDb | undefined;
  try {
    db = getPrisma(args.context as never) as unknown as HelpQuotaDb;
  } catch (err) {
    console.error("[help-chat] quota client", err instanceof Error ? err.name : "error");
    db = undefined;
  }
  return consumeHelpQuota({
    db,
    environment: environmentName(args.context),
    ip: args.ip,
    sessionId: args.sessionId,
  });
}
