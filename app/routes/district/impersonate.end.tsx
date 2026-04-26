import type { Route } from "./+types/impersonate.end";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ context, request }: Route.ActionArgs) {
  void context;
  void request;
  return new Response("Not implemented", { status: 501 });
}
