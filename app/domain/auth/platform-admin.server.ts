import { redirect } from "react-router";
import { isPlatformAdmin } from "~/domain/utils/host.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export { isPlatformAdmin };

export async function requirePlatformAdmin(context: any) {
  const user = getOptionalUserFromContext(context);
  if (!user) {
    throw redirect("/login?next=/platform");
  }
  if (!isPlatformAdmin(user, context)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
