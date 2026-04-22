/**
 * Client-safe blog helpers.
 *
 * Anything that renders inside a component (and therefore ends up in the
 * client bundle) needs to import from here, NOT from `blog.server.ts`. The
 * server module pulls in `marked` + `import.meta.glob` of every post, which
 * would balloon the client chunk and trip React Router's server-only guard.
 */

export type BlogPostMeta = {
  title: string;
  date: string; // ISO date (YYYY-MM-DD)
  slug: string;
  excerpt: string;
  author: string;
  tags: string[];
  image: string;
  /** Source filename, useful for debugging. */
  file: string;
};

/**
 * Nicely formatted date for display, e.g. "April 22, 2026". We avoid
 * `toLocaleDateString` so the output is stable regardless of the Worker's
 * runtime locale or the browser's.
 */
export function formatPostDate(iso: string): string {
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
