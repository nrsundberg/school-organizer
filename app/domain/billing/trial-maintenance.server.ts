import { getPrisma } from "~/db.server";
import {
  listQualifyingPickupDates,
  trialStillActive,
  computeTrialEndsAtUtc,
} from "~/domain/billing/trial.server";

/**
 * Nightly job: refresh qualifying-day counts and end trials when the window closes.
 */
export async function runTrialMaintenance(context: any): Promise<{ orgsChecked: number; ended: number }> {
  const db = getPrisma(context);
  const now = new Date();
  const orgs = await db.org.findMany({
    where: { status: "TRIALING", trialStartedAt: { not: null } },
  });

  let ended = 0;
  for (const org of orgs) {
    const trialStartedAt = org.trialStartedAt!;
    const dates = await listQualifyingPickupDates(db, org.id, trialStartedAt);
    const trialEndsAt =
      dates.length >= 25 ? computeTrialEndsAtUtc(trialStartedAt, dates) : null;

    await db.org.update({
      where: { id: org.id },
      data: {
        trialQualifyingPickupDays: dates.length,
        ...(trialEndsAt ? { trialEndsAt } : {}),
      },
    });

    if (!trialStillActive(org, dates, now)) {
      await db.org.update({
        where: { id: org.id },
        data: { status: "INCOMPLETE", trialEndsAt: trialEndsAt ?? org.trialEndsAt },
      });
      ended += 1;
    }
  }

  return { orgsChecked: orgs.length, ended };
}
