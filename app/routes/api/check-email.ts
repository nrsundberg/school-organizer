import { data } from "react-router";
import type { Route } from "./+types/check-email";
import { getPrisma } from "~/db.server";

export async function action({ request, context }: Route.ActionArgs) {
  let email: string;
  try {
    ({ email } = await request.json() as { email: string });
  } catch {
    return data({ error: "Invalid request" }, { status: 400 });
  }

  if (!email) {
    return data({ error: "Email required" }, { status: 400 });
  }

  const db = getPrisma(context);
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });

  return data({ exists: !!user });
}
