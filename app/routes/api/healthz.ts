import type { Route } from "./+types/healthz";

export function headers() {
  return {
    "Cache-Control": "no-store",
  };
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = (context as any)?.cloudflare?.env?.ENVIRONMENT ?? "unknown";
  return Response.json(
    { ok: true, ts: new Date().toISOString(), env },
    { headers: { "Cache-Control": "no-store" } },
  );
}
