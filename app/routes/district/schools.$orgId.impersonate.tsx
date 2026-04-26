import type { Route } from "./+types/schools.$orgId.impersonate";

export function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ context, params, request }: Route.ActionArgs) {
  void context;
  void params;
  void request;
  return new Response("Not implemented", { status: 501 });
}
