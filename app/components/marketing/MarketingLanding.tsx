import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { SUPPORTED_LANGUAGES } from "~/lib/i18n-config";

const VIDEO_EMBEDS = [
  {
    title: "Getting started",
    description: "Create your school, invite staff, and go live with the board in minutes.",
    youtubeId: "M7lc1UVf-VE",
  },
  {
    title: "Car line pickups",
    description: "How controllers move the line and how families see status in real time.",
    youtubeId: "M7lc1UVf-VE",
  },
  {
    title: "Fire drills and safety",
    description: "Use the same visibility tools when every second counts.",
    youtubeId: "M7lc1UVf-VE",
  },
] as const;

export function MarketingLanding() {
  const { t } = useTranslation("common");
  const languageCount = SUPPORTED_LANGUAGES.length;
  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <header className="border-b border-white/10 bg-[#0f1414]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-16 md:flex-row md:items-center md:justify-between md:py-24">
          <div className="max-w-xl space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#E9D500]">
              School car line, simplified
            </p>
            <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
              One board for pickups, drills, and daily chaos—without the walkie chatter.
            </h1>
            <p className="text-lg text-white/70">
              Pickup Roster gives each school its own live board, viewer access families trust, and admin tools
              your front office already understands.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] shadow-lg shadow-[#E9D500]/20 transition hover:bg-[#f5e047]"
              >
                Start free trial
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-base font-semibold text-white/90 transition hover:border-white/40"
              >
                View pricing
              </Link>
            </div>
          </div>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-br from-[#193B4B] to-[#0f1414] p-6 shadow-2xl">
            <p className="text-sm font-medium text-white/80">What you get</p>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li className="flex gap-2">
                <span className="text-[#E9D500]">✓</span>
                Subdomain per school (yourslug.pickuproster.com); Campus and District plans can bring a custom domain or a subdomain on your school's own domain.
              </li>
              <li className="flex gap-2">
                <span className="text-[#E9D500]">✓</span>
                Live board with WebSocket updates and viewer PINs or magic links.
              </li>
              <li className="flex gap-2">
                <span className="text-[#E9D500]">✓</span>
                Trial that respects real usage: calendar time and qualifying pickup days.
              </li>
              <li className="flex gap-2">
                <span className="text-[#E9D500]">✓</span>
                {t("marketing.languageCount", { count: languageCount })}
              </li>
            </ul>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">See it in action</h2>
          <p className="mt-2 text-white/60">Short walkthroughs you can share with staff and families.</p>
        </div>
        <div className="grid gap-10 md:grid-cols-1">
          {VIDEO_EMBEDS.map((block) => (
            <article
              key={block.title}
              className="overflow-hidden rounded-2xl border border-white/10 bg-[#151a1a] shadow-xl"
            >
              <div className="aspect-video w-full bg-black/40">
                <iframe
                  title={block.title}
                  src={`https://www.youtube-nocookie.com/embed/${block.youtubeId}`}
                  className="h-full w-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <div className="space-y-2 px-5 py-4">
                <h3 className="text-xl font-semibold text-white">{block.title}</h3>
                <p className="text-sm text-white/65">{block.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818] py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Ready when your school is</h2>
            <p className="mt-2 max-w-xl text-white/65">
              Start a trial from the marketing site. Your live board lives on your school subdomain—never mixed with
              other tenants.
            </p>
          </div>
          <Link
            to="/signup"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] shadow-lg shadow-[#E9D500]/15 transition hover:bg-[#f5e047]"
          >
            Create your account
          </Link>
        </div>
      </section>
    </div>
  );
}
