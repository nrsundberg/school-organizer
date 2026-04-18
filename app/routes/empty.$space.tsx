import type { Route } from "./+types/empty.$space";
import { redirect } from "react-router";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  const spaceNumber = parseInt(space);
  const env = (context as any).cloudflare.env;

  const id = env.BINGO_BOARD.idFromName("main");
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/space-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "EMPTY", spaceNumber }),
  });

  return new Response("OK");
}
