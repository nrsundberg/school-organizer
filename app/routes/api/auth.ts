import type { Route } from "./+types/auth";
import { getAuth } from "~/domain/auth/better-auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = getAuth(context);
  return auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = getAuth(context);
  return auth.handler(request);
}
