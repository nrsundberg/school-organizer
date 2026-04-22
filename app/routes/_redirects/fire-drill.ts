import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * 308 redirect from the legacy /admin/fire-drill* paths to the new /admin/drills* paths.
 * Remove after one release cycle.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const newPath = url.pathname
    .replace(/^\/admin\/print\/fire-drill/, "/admin/print/drills")
    .replace(/^\/admin\/fire-drill/, "/admin/drills");
  return redirect(newPath + url.search, 308);
}
