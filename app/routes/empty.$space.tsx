import type { Route } from "./+types/empty.$space";
import { redirect } from "react-router";
import { getOrgFromContext } from "~/domain/utils/global-context.server";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  const spaceNumber = parseInt(space);
  const env = (context as any).cloudflare.env;

  // Tenant routes always have an org. Required strictly here because we
  // route to a per-tenant DO below; pairs with /update/:space.
  const org = getOrgFromContext(context);

  const id = env.BINGO_BOARD.idFromName(org.id);
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/space-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "EMPTY", spaceNumber, orgId: org.id }),
  });

  return new Response("OK");
}
