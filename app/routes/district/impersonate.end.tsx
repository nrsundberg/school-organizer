import { redirect } from "react-router";
import type { Route } from "./+types/impersonate.end";
import { endImpersonation } from "~/domain/district/impersonation.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getAuth } from "~/domain/auth/better-auth.server";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session?.id) throw new Response("No session", { status: 401 });

  await endImpersonation(context, {
    caller: {
      id: user.id,
      districtId:
        (user as { districtId?: string | null }).districtId ?? null,
      orgId: user.orgId ?? null,
      isPlatformAdmin: (user as { role?: string }).role === "PLATFORM_ADMIN",
      email: (user as { email?: string }).email ?? null,
    },
    sessionId: session.session.id,
  });
  throw redirect("/district");
}
