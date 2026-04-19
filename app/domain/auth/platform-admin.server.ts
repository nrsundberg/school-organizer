import { redirect } from "react-router";
import { getPublicEnv } from "~/domain/utils/host.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export function isPlatformAdmin(
  user: { email: string; role: string } | null,
  context: any,
): boolean {
  if (!user) return false;
  if (user.role === "PLATFORM_ADMIN") return true;
  const env = getPublicEnv(context);
  const allow = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(user.email.toLowerCase());
}

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
