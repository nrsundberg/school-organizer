import { Link } from "react-router";
import type { Route } from "./+types/faqs";
import { MarketingNav } from "~/components/marketing/MarketingNav";

export function meta() {
  return [
    { title: "FAQs — Pickup Roster" },
    {
      name: "description",
      content: "Common questions about car line boards, trials, and security."
    }
  ];
}

export async function loader() {
  return null;
}

const FAQS = [
  {
    q: "Where does my school live?",
    a: "Each organization gets its own subdomain like yourslug.pickuproster.com. The main domain shows this marketing site; the board never mixes tenants. On Campus and District plans you can instead use a custom domain or a subdomain on your school's own domain (for example, pickup.yourschool.edu)."
  },
  {
    q: "How does the trial work?",
    a: "Your trial ends on the later of 30 calendar days from signup or 25 qualifying pickup days. A qualifying day is a day with more than 10 distinct students marked as called."
  },
  {
    q: "How do families view the board?",
    a: "Share the viewer PIN or a magic link. Viewer sessions are scoped to your organization and respect lockouts after failed attempts."
  },
  {
    q: "Can we use our own domain?",
    a: "Yes — custom domains (or a subdomain on your school's own domain) are available on Campus and District plans. Point DNS to the same Worker as your other hosts. Car Line uses a yourslug.pickuproster.com subdomain."
  }
];

export default function Faqs() {
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-4xl font-extrabold">FAQs</h1>
        <p className="mt-3 text-lg text-white/70">
          Straight answers for admins and IT.
        </p>

        <div className="mt-10 space-y-8">
          {FAQS.map((item) => (
            <div
              key={item.q}
              className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
            >
              <h2 className="text-lg font-semibold text-[#E9D500]">{item.q}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                {item.a}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-white/50">
          Ready to try it?{" "}
          <Link
            to="/pricing"
            className="text-[#E9D500] underline hover:text-[#f5e047]"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
