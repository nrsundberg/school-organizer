import { Link } from "react-router";
import type { Route } from "./+types/support";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { createPrismaSupportStore } from "~/domain/help/tickets.server";
import { TICKET_STATUSES, type TicketStatus } from "~/domain/help/limits";
import { getPrisma } from "~/db.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Support" }];

function formatWhen(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function statusClass(status: string): string {
  if (status === "open") return "bg-[#E9D500]/20 text-[#E9D500]";
  if (status === "replied") return "bg-sky-400/15 text-sky-200";
  return "bg-white/10 text-white/60";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const raw = new URL(request.url).searchParams.get("status");
  const status = TICKET_STATUSES.includes(raw as TicketStatus) ? (raw as TicketStatus) : null;
  const tickets = await createPrismaSupportStore(getPrisma(context)).list(status);
  return { tickets, status };
}

export default function PlatformSupport({ loaderData }: Route.ComponentProps) {
  const { tickets, status } = loaderData;
  const filters: { label: string; value: TicketStatus | null }[] = [
    { label: "All", value: null },
    { label: "Open", value: "open" },
    { label: "Replied", value: "replied" },
    { label: "Closed", value: "closed" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Support inbox</h1>
        <p className="mt-1 text-sm text-white/60">
          Tickets from the help chat and the contact form, newest first.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = status === filter.value;
          const to = filter.value ? `/platform/support?status=${filter.value}` : "/platform/support";
          return (
            <Link
              key={filter.label}
              to={to}
              className={[
                "rounded-full px-3 py-1 text-sm",
                active ? "bg-[#E9D500] text-[#193B4B]" : "bg-white/10 text-white/80 hover:bg-white/15",
              ].join(" ")}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Opened</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">From</th>
              <th className="px-3 py-2 font-semibold">Subject</th>
              <th className="px-3 py-2 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-white/70">{formatWhen(ticket.createdAt)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${statusClass(ticket.status)}`}>
                    {ticket.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{ticket.requesterName}</div>
                  <div className="font-mono text-xs text-white/60">{ticket.requesterEmail}</div>
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/platform/support/${ticket.id}`}
                    className="font-medium text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    {ticket.subject}
                  </Link>
                </td>
                <td className="px-3 py-2 text-white/70">{ticket.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tickets.length === 0 ? (
        <p className="text-sm text-white/50">No tickets in this view.</p>
      ) : null}
    </div>
  );
}
