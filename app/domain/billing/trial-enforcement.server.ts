import { data } from "react-router";
import { getPrisma } from "~/db.server";
import { evaluateTrial } from "~/domain/billing/trial.server";

/**
 * Asserts that the org's trial allows creating a new pickup event.
 * Throws a 402 data response if the free trial has expired.
 *
 * Call this at the top of the pickup-creation action — NOT in loaders,
 * so read access remains open for families / viewers.
 */
export async function assertTrialAllowsNewPickup(
  context: unknown,
  orgId: string,
): Promise<void> {
  const db = getPrisma(context as any);

  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org) return; // Can't resolve org — let the action fail for other reasons

  // Non-FREE plans are never blocked by trial logic
  if (org.billingPlan !== "FREE") return;

  // Count distinct calendar days (UTC) where the org has CallEvent rows with a studentId.
  // trialQualifyingPickupDays is updated by the nightly cron (trial-maintenance.server.ts),
  // but we re-count live here for real-time accuracy at enforcement time.
  const now = new Date();

  // Use the denormalized column if the trial hasn't started yet (no extra query needed)
  // Otherwise count directly from CallEvent for accuracy.
  let pickupDaysUsed: number;

  if (!org.trialStartedAt) {
    pickupDaysUsed = 0;
  } else {
    // Count distinct UTC date strings from CallEvent rows for this org
    const rows = await db.callEvent.findMany({
      where: {
        orgId,
        studentId: { not: null },
        createdAt: { gte: org.trialStartedAt },
      },
      select: { createdAt: true },
    });

    const distinctDays = new Set(
      rows.map((r) => new Date(r.createdAt).toISOString().slice(0, 10)),
    );
    pickupDaysUsed = distinctDays.size;
  }

  const status = evaluateTrial({
    billingPlan: "FREE",
    trialStartedAt: org.trialStartedAt,
    now,
    pickupDaysUsed,
    compedUntil: org.compedUntil,
  });

  if (!status.isActive && status.reason === "expired") {
    throw data(
      {
        error:
          "Your free trial has ended. Upgrade to continue recording pickups.",
        cta: "/admin/billing",
      },
      { status: 402 },
    );
  }
}
