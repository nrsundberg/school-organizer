import { getPrisma } from "~/db.server";
import { enqueueEmails } from "./queue.server";
import type { EmailMessage } from "./types";

/**
 * Nightly job that enqueues trial lifecycle emails.
 *
 * Two windows:
 *   - trial_expiring: orgs whose `trialEndsAt` lands 7, 3, or 1 day(s) from
 *     now (UTC). One email per (org, daysLeft) — idempotent via SentEmail.
 *   - mid_trial_checkin: orgs ~14 days into their trial (trialStartedAt was
 *     14 days ago, +/- 0 days). One email per org total.
 *
 * Idempotency: each (orgId, kind, bucket) combo is recorded in the SentEmail
 * table on first successful enqueue. The cron can safely re-run daily.
 */
export async function runTrialEmailNotifications(context: any): Promise<{
  trialExpiring: number;
  midTrialCheckin: number;
}> {
  const db = getPrisma(context);
  const now = new Date();

  const expiringCounts = await enqueueTrialExpiring(db, now, context);
  const checkinCount = await enqueueMidTrialCheckins(db, now, context);

  return { trialExpiring: expiringCounts, midTrialCheckin: checkinCount };
}

// ---- helpers ----

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Format a trial end date for email copy — e.g. "April 28". */
function formatTrialEndDate(d: Date | null | undefined): string {
  if (!d) return "soon";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Pull a first name out of a full-name string. Null-safe. */
function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * Find orgs whose trialEndsAt falls inside [targetDay, targetDay+1) UTC
 * and which haven't already received the `trial_expiring` email for that
 * daysLeft value. Returns the count enqueued.
 */
async function enqueueTrialExpiring(db: any, now: Date, context: any): Promise<number> {
  const today = startOfUtcDay(now);
  let total = 0;

  for (const daysLeft of [7, 3, 1] as const) {
    const dayStart = addDaysUtc(today, daysLeft);
    const dayEnd = addDaysUtc(dayStart, 1);
    const bucket = `daysLeft=${daysLeft}`;

    const orgs = await db.org.findMany({
      where: {
        status: "TRIALING",
        trialEndsAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        trialEndsAt: true,
        defaultLocale: true,
        users: {
          where: { role: "ADMIN" },
          select: { email: true, name: true, locale: true },
          take: 5,
        },
      },
    });

    const messages: EmailMessage[] = [];
    const sentRecords: { orgId: string; kind: string; bucket: string }[] = [];

    for (const org of orgs) {
      if (!org.users.length) continue;
      const already = await db.sentEmail.findUnique({
        where: { orgId_kind_bucket: { orgId: org.id, kind: "trial_expiring", bucket } },
      }).catch(() => null);
      if (already) continue;

      const trialEndDate = formatTrialEndDate(org.trialEndsAt);

      for (const admin of org.users) {
        if (!admin.email) continue;
        messages.push({
          kind: "trial_expiring",
          to: admin.email,
          orgName: org.name,
          orgSlug: org.slug,
          daysLeft,
          trialEndDate,
          userName: firstName(admin.name),
          locale: admin.locale ?? org.defaultLocale ?? undefined,
        });
      }
      sentRecords.push({ orgId: org.id, kind: "trial_expiring", bucket });
    }

    if (messages.length) {
      await enqueueEmails(context, messages);
      await db.sentEmail.createMany({
        data: sentRecords.map((r) => ({ ...r, sentAt: now })),
      });
      total += messages.length;
    }
  }

  return total;
}

/**
 * Enqueue a mid-trial check-in for orgs whose trial started ~14 days ago.
 * Window is [today-14, today-13) UTC so we fire exactly once even if the
 * cron is late or re-runs.
 */
async function enqueueMidTrialCheckins(db: any, now: Date, context: any): Promise<number> {
  const today = startOfUtcDay(now);
  const windowStart = addDaysUtc(today, -14);
  const windowEnd = addDaysUtc(today, -13);
  const bucket = "day=14";

  const orgs = await db.org.findMany({
    where: {
      status: "TRIALING",
      trialStartedAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultLocale: true,
      users: {
        where: { role: "ADMIN" },
        select: { email: true, name: true, locale: true },
        take: 5,
      },
    },
  });

  const messages: EmailMessage[] = [];
  const sentRecords: { orgId: string; kind: string; bucket: string }[] = [];

  for (const org of orgs) {
    if (!org.users.length) continue;
    const already = await db.sentEmail.findUnique({
      where: { orgId_kind_bucket: { orgId: org.id, kind: "mid_trial_checkin", bucket } },
    }).catch(() => null);
    if (already) continue;

    for (const admin of org.users) {
      if (!admin.email) continue;
      messages.push({
        kind: "mid_trial_checkin",
        to: admin.email,
        orgName: org.name,
        orgSlug: org.slug,
        daysIn: 14,
        userName: firstName(admin.name),
        locale: admin.locale ?? org.defaultLocale ?? undefined,
      });
    }
    sentRecords.push({ orgId: org.id, kind: "mid_trial_checkin", bucket });
  }

  if (messages.length) {
    await enqueueEmails(context, messages);
    await db.sentEmail.createMany({
      data: sentRecords.map((r) => ({ ...r, sentAt: now })),
    });
  }

  return messages.length;
}
