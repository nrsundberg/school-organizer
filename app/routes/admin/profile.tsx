import type { Route } from "./+types/profile";
import { protectRoute } from "~/sessions.server";
import ProfileForm from "~/components/profile/ProfileForm";

export const handle = { i18n: ["profile", "common"] };

export async function loader({ context }: Route.LoaderArgs) {
  const user = await protectRoute(context);
  return {
    user: { name: user.name ?? "", email: user.email },
  };
}

export default function AdminProfile({ loaderData }: Route.ComponentProps) {
  return <ProfileForm user={loaderData.user} logoutHref="/logout" />;
}
