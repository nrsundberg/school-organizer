import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, X } from "lucide-react";

const SNOOZE_KEY = "households-dup-banner-snoozed-until";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Warns staff that some pickup spaces have duplicate households and links to the
 * merge view. SSR-safe: `show` starts false on the server AND on the first
 * client render, so hydration matches. A useEffect then flips it on only when
 * there are duplicates and the banner isn't currently snoozed — no flash, no
 * mismatch. "Dismiss" snoozes it in localStorage for 30 days.
 */
export default function DuplicateHouseholdsBanner({ count }: { count: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (count <= 0) return;
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? "0");
    if (Date.now() < until) return;
    setShow(true);
  }, [count]);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setShow(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        {count} pickup space{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"}{" "}
        duplicate households.{" "}
        <Link to="/admin/households/duplicates" className="font-medium underline">
          Review &amp; merge
        </Link>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for 30 days"
        className="rounded p-1 text-amber-100/70 hover:bg-amber-400/10 hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
