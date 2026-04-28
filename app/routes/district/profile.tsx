import type { Route } from "./+types/profile";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getUserFromContext } from "~/domain/utils/global-context.server";
import ProfileForm from "~/components/profile/ProfileForm";

export const handle = { i18n: ["profile", "common"] };

export async function loader({ context }: Route.LoaderArgs) {
  requireDistrictAdmin(context);
  const user = getUserFromContext(context);
  return {
    user: { name: user.name ?? "", email: user.email },
  };
}

export default function DistrictProfile({ loaderData }: Route.ComponentProps) {
  return <ProfileForm user={loaderData.user} logoutHref="/logout" />;
}
