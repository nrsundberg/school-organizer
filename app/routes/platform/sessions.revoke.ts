import { data } from "react-router";
import { redirectWithSuccess } from "remix-toast";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { Route } from "./+types/sessions.revoke";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPrisma } from "~/db.server";

export async function loader() {
  return data({ error: "Method not allowed" }, { status: 405 });
}

const revokeSchema = zfd.formData({
  sessionId: zfd.text(),
  returnEmail: zfd.text(z.string().optional()),
  returnSince: zfd.text(z.string().optional()),
});

export async function action({ request, context }: Route.ActionArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);

  const formData = await request.formData();
  const parsed = revokeSchema.safeParse(formData);
  if (!parsed.success) {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  const { sessionId, returnEmail, returnSince } = parsed.data;

  // Delete the session directly via Prisma (better-auth revokeSession endpoint
  // requires an authenticated caller session token, not an admin API; direct DB
  // deletion is the safe server-side approach here).
  await db.session.delete({ where: { id: sessionId } });

  // Build return URL preserving the user's current filter state
  const params = new URLSearchParams();
  if (returnEmail) params.set("email", returnEmail);
  if (returnSince) params.set("since", returnSince);
  const qs = params.toString();
  const returnUrl = `/platform/sessions${qs ? `?${qs}` : ""}`;

  return redirectWithSuccess(returnUrl, { message: "Session revoked." });
}
