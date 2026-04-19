import { getPrisma } from "~/db.server";
import type { Route } from "./+types/webhooks";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Webhooks" }];

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const events = await db.stripeWebhookEvent.findMany({
    take: 200,
    orderBy: { createdAt: "desc" },
  });
  return { events };
}

export default function PlatformWebhooks({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Stripe webhooks</h1>
        <p className="mt-1 text-sm text-white/60">Last 200 events stored (newest first).</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Stripe event ID</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-white/70">
                  {ev.createdAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </td>
                <td className="px-3 py-2 font-mono text-xs">{ev.type}</td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">{ev.stripeEventId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
