/**
 * Drill cadence math — pure helpers for the "next due / overdue" pill on the
 * admin drills list.
 *
 * Why a separate module: the loader composes this with a Prisma `findFirst`
 * for the most recent ENDED run; the math itself is trivial but easy to get
 * wrong (off-by-one on day boundaries, forgetting "no last run" means due-now,
 * etc.) so we pull it out for unit testing.
 *
 * NFPA 101 mandates monthly K-12 fire drills (requiredPerYear=12); most state
 * DOEs require lockdown drills annually-to-quarterly (1–4). Threshold is
 * `365/requiredPerYear` days between consecutive ENDED runs.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CadenceStatus {
  /** "overdue" if past the cadence window, "due" if still within it, "none" if no cadence configured. */
  state: "overdue" | "due" | "none";
  /**
   * Days remaining until the next run is due (positive) or days past due
   * (positive number, with state="overdue"). Always non-negative.
   * Undefined when state is "none".
   */
  days?: number;
}

/**
 * Compute the cadence status for a template.
 *
 * @param requiredPerYear  Cadence target. Null/0/negative → state="none".
 * @param lastEndedAt      Timestamp of the most recent ENDED run for this
 *                         template. Null when no run has ever ended → treated
 *                         as immediately overdue (the cadence window is
 *                         already exhausted) so admins onboarding a fresh
 *                         template are nudged to run their first drill.
 * @param now              Current time. Injectable for tests.
 */
export function computeCadenceStatus(
  requiredPerYear: number | null | undefined,
  lastEndedAt: Date | null,
  now: Date,
): CadenceStatus {
  if (
    requiredPerYear === null ||
    requiredPerYear === undefined ||
    !Number.isFinite(requiredPerYear) ||
    requiredPerYear <= 0
  ) {
    return { state: "none" };
  }

  const windowMs = (365 / requiredPerYear) * MS_PER_DAY;

  // No prior ENDED run → considered overdue from day 1, with `days` =
  // however far over the window we already are (treat lastEndedAt as
  // `now - windowMs - 1ms` so the math reads as "0 days past due").
  if (!lastEndedAt) {
    return { state: "overdue", days: 0 };
  }

  const elapsedMs = now.getTime() - lastEndedAt.getTime();
  const remainingMs = windowMs - elapsedMs;

  if (remainingMs <= 0) {
    // Past due. Round up so "0.4 days over" still surfaces as "1d overdue".
    const overdueDays = Math.max(0, Math.ceil(-remainingMs / MS_PER_DAY));
    return { state: "overdue", days: overdueDays };
  }

  // Still inside the cadence window. Round down so "5.9 days remaining"
  // shows "5d" — admins planning out the week think in completed days.
  const remainingDays = Math.max(0, Math.floor(remainingMs / MS_PER_DAY));
  return { state: "due", days: remainingDays };
}
