/**
 * Client-safe guide helpers.
 *
 * Anything that renders inside a component (and therefore ends up in the
 * client bundle) needs to import from here, NOT from `guides.server.ts`. The
 * server module pulls in `marked` + `import.meta.glob` of every guide.
 */

export type GuideDifficulty = "beginner" | "intermediate" | "advanced";

export type GuideMeta = {
  title: string;
  date: string; // ISO date (YYYY-MM-DD)
  slug: string;
  /**
   * Top-level grouping. Free-form, but conventional buckets are
   * `setup`, `operations`, `safety`, `billing`, `troubleshooting`.
   */
  category: string;
  /** Human-readable estimate e.g. "8 minutes". Stored as-authored. */
  estimatedTime: string;
  difficulty: GuideDifficulty;
  /** Source filename, useful for debugging. */
  file: string;
};

/** Display label for a category slug. Falls back to title-casing the slug. */
export function formatCategory(category: string): string {
  if (!category) return "Guides";
  return category
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

/** Display label for difficulty. */
export function formatDifficulty(d: GuideDifficulty | string): string {
  switch (d) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "advanced":
      return "Advanced";
    default:
      return d ? d[0].toUpperCase() + d.slice(1) : "";
  }
}

/**
 * Nicely formatted date for display, e.g. "April 22, 2026". We avoid
 * `toLocaleDateString` so the output is stable regardless of the Worker's
 * runtime locale or the browser's.
 */
export function formatGuideDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}
