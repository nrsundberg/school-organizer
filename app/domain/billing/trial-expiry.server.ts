import { getPrisma } from "~/db.server";

/**
 * Daily job: flip expired trialing orgs to `SUSPENDED`.
 *
 * Trigger: `status = TRIALING`, `trialEndsAt <= now`, and the org has not
 * converted to a paid subscription (no active Stripe subscription — we only
 * guard against orgs that converted and then got an ACTIVE status via webhook,
 * which would already have a non-TRIALING status).
 *
 * Comped orgs (`isComped = true`) are skipped.
 *
 * Idempotent: orgs that are already SUSPENDED are left alone because the
 * `where` clause filters on `status = TRIALING`. Safe to run every day.
 */
export async function suspendExpiredTrialingOrgs(
  context: any,
): Promise<{ checked: number; suspended: number }> {
  const db = getPrisma(context);
  const now = new Date();

  // Raw find: we need `isComped` on the row. Cast the shape because the
  // generated client may not yet reflect the column until `prisma generate`
  // runs against the updated schema.
  const orgs = (await db.org.findMany({
    where: {
      status: "TRIALING",
      trialEndsAt: { lte: now, not: null },
    },
  })) as Array<{
    id: string;
    status: string;
    trialEndsAt: Date | null;
    isComped?: boolean;
  }>;

  let suspended = 0;
  for (const org of orgs) {
    if (org.isComped) continue;
    await db.org.update({
      where: { id: org.id },
      data: { status: "SUSPENDED" },
    });
    suspended += 1;
  }

  return { checked: orgs.length, suspended };
}
