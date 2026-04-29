import { getPrisma } from "~/db.server";
import {
  evaluateTrialStatus,
  applyTrialEvaluation,
} from "~/domain/billing/trial-lifecycle.server";

/**
 * Nightly job: refresh qualifying-day counts and end trials when the
 * window closes. Delegates the rule logic to `trial-lifecycle.server`.
 */
export async function runTrialMaintenance(
  context: any,
): Promise<{ orgsChecked: number; ended: number }> {
  const db = getPrisma(context);
  const now = new Date();
  const orgs = await db.org.findMany({
    where: { status: "TRIALING", trialStartedAt: { not: null } },
  });

  let ended = 0;
  for (const org of orgs) {
    const evaluation = await evaluateTrialStatus(org, db, now);
    await applyTrialEvaluation(db, org.id, evaluation);
    if (evaluation.kind === "should_end") ended += 1;
  }

  return { orgsChecked: orgs.length, ended };
}
