import { Link } from "react-router";

export function MarketingNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#0f1414]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="text-lg font-bold tracking-tight text-white">
          School<span className="text-[#E9D500]"> Organizer</span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm font-medium text-white/80">
          <Link to="/pricing" className="transition hover:text-white">
            Pricing
          </Link>
          <Link to="/faqs" className="transition hover:text-white">
            FAQs
          </Link>
          <Link to="/login" className="transition hover:text-white">
            Log in
          </Link>
          <Link
            to="/signup"
            className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-[#193B4B] transition hover:bg-[#f5e047]"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  );
}
