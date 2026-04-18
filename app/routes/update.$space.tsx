import type { Route } from "./+types/update.$space";
import { redirect } from "react-router";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  const spaceNumber = parseInt(space);
  const timestamp = new Date().toISOString();
  const env = (context as any).cloudflare.env;

  const id = env.BINGO_BOARD.idFromName("main");
  const stub = env.BINGO_BOARD.get(id);
  await stub.fetch("https://internal/space-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "ACTIVE", spaceNumber, timestamp }),
  });

  return new Response("OK");
}
