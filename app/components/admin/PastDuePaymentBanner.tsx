import { Link } from "react-router";

type Props = {
  /** ISO instant for calendar day shown as suspension date (pastDueSinceAt + 14d UTC). */
  suspendOnIso: string;
};

function formatCalendarDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PastDuePaymentBanner({ suspendOnIso }: Props) {
  const suspendLabel = formatCalendarDay(suspendOnIso);

  return (
    <div className="border-b border-amber-500/40 bg-amber-950/80 px-4 py-2.5 text-sm">
      <p className="font-medium text-white">
        Payment failed — your subscription is past due.
      </p>
      <p className="mt-1 text-white/80">
        If payment is not received, this account will be suspended on{" "}
        <span className="font-semibold text-white">{suspendLabel}</span> (14 days from the first past-due
        notice).
      </p>
      <p className="mt-2">
        <Link
          to="/pricing"
          className="text-[#E9D500] underline underline-offset-2 hover:text-[#f5e047]"
        >
          Update billing
        </Link>
      </p>
    </div>
  );
}
