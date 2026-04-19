import { data } from "react-router";
import type { Route } from "./+types/check-org-slug";
import { getAuth } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";
import { slugifyOrgName } from "~/lib/org-slug";

export async function action({ request, context }: Route.ActionArgs) {
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return data({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { slug?: string };
  try {
    body = (await request.json()) as { slug?: string };
  } catch {
    return data({ error: "Invalid request." }, { status: 400 });
  }

  const slug = slugifyOrgName(body.slug?.trim() ?? "");
  if (!slug) {
    return data({ error: "A valid slug is required." }, { status: 400 });
  }

  const db = getPrisma(context);
  const existing = await db.org.findUnique({ where: { slug } });
  return data({ available: !existing, slug });
}
