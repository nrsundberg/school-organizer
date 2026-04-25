/**
 * /api/user-prefs — write user-scoped preferences.
 *
 * Currently handles two fields, both optional in any one request:
 *
 *  - `controllerViewPreference` — "board" | "controller" (CONTROLLER role only)
 *  - `locale` — UI language code (any logged-in user)
 *
 * Accepts both `application/json` and `application/x-www-form-urlencoded` /
 * multipart form data. The LanguageSwitcher posts JSON; the original
 * controller view toggle posts form-data. We sniff the Content-Type to
 * decide.
 *
 * Returns `{ ok: true }` on success, `{ error: "..." }` with the usual
 * 400/403 status codes on rejection.
 */

import { data } from "react-router";
import type { Route } from "./+types/user-prefs";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { isSupportedLanguage } from "~/lib/i18n-config";

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) {
    return data({ error: "Unauthorized" }, { status: 403 });
  }

  // Parse the body once. Languages is JSON, controller-view toggle is form.
  const contentType = request.headers.get("Content-Type") ?? "";
  let payload: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return data({ error: "Invalid JSON" }, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    formData.forEach((v, k) => {
      payload[k] = v;
    });
  }

  // Build a Prisma update object additively — we never overwrite columns
  // the request didn't mention.
  const update: { controllerViewPreference?: string; locale?: string } = {};

  // Controller view toggle (existing behavior; CONTROLLER role only).
  if (typeof payload.controllerViewPreference === "string") {
    if (user.role !== "CONTROLLER") {
      return data({ error: "Unauthorized" }, { status: 403 });
    }
    const view = payload.controllerViewPreference;
    if (view !== "board" && view !== "controller") {
      return data({ error: "Invalid preference" }, { status: 400 });
    }
    update.controllerViewPreference = view;
  }

  // Locale (any logged-in user).
  if (typeof payload.locale === "string") {
    if (!isSupportedLanguage(payload.locale)) {
      return data({ error: "Invalid locale" }, { status: 400 });
    }
    update.locale = payload.locale;
  }

  if (Object.keys(update).length === 0) {
    return data({ error: "No valid preference fields" }, { status: 400 });
  }

  await getPrisma(context).user.update({
    where: { id: user.id },
    data: update,
  });
  return data({ ok: true });
}
