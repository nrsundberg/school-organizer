/**
 * usePrintLocale — pick the locale to render a print route in.
 *
 * Centralizes the rule decided in the i18n plan:
 *
 *   - `print.board`  → `org.defaultLocale`
 *   - `print.master` → `org.defaultLocale`
 *   - `print.homeroom.$teacherId` → `teacher.locale ?? org.defaultLocale`
 *
 * The audience for board / master prints is generic (posted publicly,
 * staff-wide), so we tie those to the org default rather than to whoever
 * happened to click "Print". The homeroom view is targeted at one
 * teacher, so it honors a per-teacher override when set.
 *
 * Phase 2 Agent B calls this from the three print routes. The loader for
 * each route is responsible for putting the resolved locale in its
 * returned data; this hook just reads it. We pass the `routeName` so we
 * can add per-route fallbacks later without changing call sites.
 */

import { useRouteLoaderData } from "react-router";
import {
  pickSupportedLanguage,
  type SupportedLanguage,
} from "~/lib/i18n-config";

export type PrintRouteName = "board" | "master" | "homeroom";

/**
 * Loader data shape this hook expects. Each print route's loader should
 * include either `printLocale` (preferred) or — for backwards compat —
 * `locale`. We accept both so Phase 2 can extract gradually.
 */
interface PrintLoaderData {
  printLocale?: string;
  locale?: string;
  /** Optional fallback for homeroom when teacher.locale is null. */
  orgDefaultLocale?: string;
}

/**
 * Resolve the locale a print render should use.
 *
 * @param routeName which print route is calling — currently used for
 *   selecting the right route id when reading loader data.
 * @param teacherId (optional) teacher being printed, when routeName is
 *   "homeroom". Reserved for future use; the loader is the source of
 *   truth for the resolved locale today.
 *
 * Returns a `SupportedLanguage` — never undefined.
 */
export function usePrintLocale(
  routeName: PrintRouteName,
  // Reserved: loader currently does the lookup; kept on the signature so
  // callers don't have to change when we move the resolution into the hook.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  teacherId?: number | string,
): SupportedLanguage {
  const routeId = routeIdFor(routeName);
  const data = useRouteLoaderData(routeId) as PrintLoaderData | undefined;

  const candidate = data?.printLocale ?? data?.locale ?? data?.orgDefaultLocale;
  return pickSupportedLanguage(candidate);
}

function routeIdFor(routeName: PrintRouteName): string {
  switch (routeName) {
    case "board":
      return "routes/admin/print.board";
    case "master":
      return "routes/admin/print.master";
    case "homeroom":
      return "routes/admin/print.homeroom.$teacherId";
  }
}
