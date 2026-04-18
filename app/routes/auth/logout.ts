import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { getAuth } from "~/domain/auth/better-auth.server";
import { clearViewerSessionCookie } from "~/domain/auth/viewer-access.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const headers = new Headers();

  try {
    const auth = getAuth(context);
    const signOutResponse = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    });
    const cookies = signOutResponse.headers.getSetCookie?.() ?? [];
    for (const cookie of cookies) {
      headers.append("Set-Cookie", cookie);
    }
  } catch {
    // No session to clear — that's fine
  }
  headers.append("Set-Cookie", clearViewerSessionCookie(context));

  throw redirect("/", { headers });
}
