import { Link } from "react-router";
import { data } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/webhooks.$eventId";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";

export const meta: Route.MetaFunction = ({ params }) => [
  { title: `Platform — Webhook ${params.eventId}` },
];

export async function loader({ params, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = await (db.stripeWebhookEvent.findUnique as any)({
    where: { stripeEventId: params.eventId },
  }) as { id: string; stripeEventId: string; type: string; payload: unknown; createdAt: Date } | null;

  if (!event) {
    throw data({ error: "Event not found" }, { status: 404 });
  }

  return { event };
}

export default function WebhookDetail({ loaderData }: Route.ComponentProps) {
  const { event } = loaderData;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/platform/webhooks"
          className="text-sm text-[#E9D500] underline hover:text-[#f5e047]"
        >
          ← Back to webhooks
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-bold">Webhook Event</h1>
        <p className="mt-1 font-mono text-sm text-white/60">{event.stripeEventId}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-white/50">Type</dt>
          <dd className="mt-0.5 font-mono text-xs">{event.type}</dd>
        </div>
        <div>
          <dt className="text-white/50">Received at</dt>
          <dd className="mt-0.5 text-white/80">
            {event.createdAt.toISOString().replace("T", " ").slice(0, 19)}Z
          </dd>
        </div>
        <div>
          <dt className="text-white/50">Internal ID</dt>
          <dd className="mt-0.5 font-mono text-xs text-white/60">{event.id}</dd>
        </div>
      </dl>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-white/70">Raw payload</h2>
        {event.payload ? (
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/80">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-white/40 italic">
            No payload stored (event recorded before payload capture was added).
          </p>
        )}
      </div>
    </div>
  );
}
