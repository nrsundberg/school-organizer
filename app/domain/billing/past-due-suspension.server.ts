import { getPrisma } from "~/db.server";
import { addDaysUtc } from "~/domain/billing/trial.server";

/**
 * After 14 UTC calendar days in Stripe `past_due`, set org.status to SUSPENDED.
 * subscriptionStatus stays PAST_DUE until Stripe updates it (e.g. payment succeeds).
 */
export async function runPastDueSuspension(context: any): Promise<{ suspended: number }> {
  const db = getPrisma(context);
  const cutoff = addDaysUtc(new Date(), -14);

  const candidates = await db.org.findMany({
    where: {
      pastDueSinceAt: { not: null, lte: cutoff },
      subscriptionStatus: "PAST_DUE",
      status: "PAST_DUE",
    },
    select: { id: true },
  });

  let suspended = 0;
  for (const row of candidates) {
    await db.org.update({
      where: { id: row.id },
      data: { status: "SUSPENDED" },
    });
    suspended += 1;
  }

  return { suspended };
}
