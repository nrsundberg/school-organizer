import { Form, Link } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/webhooks";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Webhooks" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const since = url.searchParams.get("since") ?? "";

  const where: Record<string, unknown> = {};
  if (type.trim()) {
    where.type = { contains: type.trim() };
  }
  if (since.trim()) {
    const sinceDate = new Date(since.trim());
    if (!isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  const events = await db.stripeWebhookEvent.findMany({
    where,
    take: 200,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripeEventId: true,
      type: true,
      createdAt: true,
    },
  });
  return { events, type, since };
}

export default function PlatformWebhooks({ loaderData }: Route.ComponentProps) {
  const { events, type, since } = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Stripe webhooks</h1>
        <p className="mt-1 text-sm text-white/60">Last 200 events (filtered), newest first.</p>
      </div>

      {/* Filter form */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Event type contains</span>
          <input
            type="search"
            name="type"
            defaultValue={type}
            placeholder="customer.subscription"
            className="min-w-[220px] rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Since</span>
          <input
            type="date"
            name="since"
            defaultValue={since}
            className="rounded-lg border border-white/15 bg-[#0f1414] px-3 py-2 text-white focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#E9D500]/20 px-4 py-2 text-sm font-medium text-[#E9D500] hover:bg-[#E9D500]/30"
        >
          Filter
        </button>
        <a
          href="/platform/webhooks"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:text-white"
        >
          Reset
        </a>
      </Form>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Stripe event ID</th>
              <th className="px-3 py-2 font-semibold">Payload</th>
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
                <td className="px-3 py-2">
                  <Link
                    to={`/platform/webhooks/${ev.stripeEventId}`}
                    className="text-xs text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
