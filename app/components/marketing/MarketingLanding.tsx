import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { homeCopy } from "~/lib/home-copy";

const VIDEO_EMBEDS = [
  {
    id: "gettingStarted",
    src: "/marketing/videos/getting-started.mp4",
    poster: "/marketing/posters/getting-started.jpg",
  },
  {
    id: "carLine",
    src: "/marketing/videos/car-line-pickups.mp4",
    poster: "/marketing/posters/car-line-pickups.jpg",
  },
  {
    id: "fireDrills",
    src: "/marketing/videos/fire-drills-safety.mp4",
    poster: "/marketing/posters/fire-drills-safety.jpg",
  },
] as const;

const yellowButton =
  "inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-6 py-3 text-base font-semibold text-[#193B4B] shadow-lg shadow-[#E9D500]/20 transition hover:bg-[#f5e047]";
const demoButton =
  "inline-flex items-center justify-center rounded-xl border border-[#E9D500]/50 px-6 py-3 text-base font-semibold text-[#E9D500] transition hover:border-[#E9D500]";
const ghostButton =
  "inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-base font-semibold text-white/90 transition hover:border-white/40";

export function MarketingLanding() {
  const { t, i18n } = useTranslation("common");
  const copy = homeCopy(i18n.language);

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <header className="border-b border-white/10 bg-[#0f1414]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-16 md:flex-row md:items-center md:justify-between md:py-24">
          <div className="max-w-xl space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#E9D500]">
              {copy.kicker}
            </p>
            <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
              {copy.h1}
            </h1>
            <p className="text-lg text-white/70">{copy.lede}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/signup?plan=car-line" className={yellowButton}>
                {copy.startTrial}
              </Link>
              <Link to="/demo" className={demoButton}>
                {copy.bookDemo}
              </Link>
              <Link to="/pricing" className={ghostButton}>
                {copy.viewPricing}
              </Link>
            </div>
          </div>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-br from-[#193B4B] to-[#0f1414] p-6 shadow-2xl">
            <ol className="space-y-4">
              {copy.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E9D500] text-sm font-bold text-[#193B4B]">
                    {index + 1}
                  </span>
                  <p className="font-semibold leading-snug">{step.title}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-3xl font-bold">{copy.problemTitle}</h2>
        <div className="mt-6 max-w-3xl space-y-4 text-lg leading-relaxed text-white/75">
          {copy.problem.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-3xl font-bold">{copy.howTitle}</h2>
          <p className="mt-3 max-w-3xl text-white/70">{copy.howLede}</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {copy.steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
              >
                <p className="text-sm font-bold text-[#E9D500]">{index + 1}</p>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">
            {t("marketingLanding.videos.heading")}
          </h2>
          <p className="mt-2 text-white/60">
            {t("marketingLanding.videos.subtitle")}
          </p>
        </div>
        <div className="grid gap-10">
          {VIDEO_EMBEDS.map((block) => {
            const title = t(`marketingLanding.videos.${block.id}.title`);
            const description = t(
              `marketingLanding.videos.${block.id}.description`,
            );
            return (
              <article
                key={block.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#151a1a] shadow-xl"
              >
                <div className="aspect-[1280/800] w-full bg-black/40">
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    poster={block.poster}
                    width={1280}
                    height={800}
                    aria-label={title}
                    src={block.src}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="space-y-2 px-5 py-4">
                  <h3 className="text-xl font-semibold text-white">{title}</h3>
                  <p className="text-sm text-white/65">{description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-3xl font-bold">{copy.featuresTitle}</h2>
          <p className="mt-3 max-w-3xl text-white/70">{copy.featuresLede}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {copy.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
              >
                <h3 className="font-semibold text-[#E9D500]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-3xl font-bold">{copy.whoTitle}</h2>
        <div className="mt-6 max-w-3xl space-y-4 text-lg leading-relaxed text-white/75">
          {copy.who.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-3xl font-bold">{copy.pricingTitle}</h2>
          <div className="mt-6 max-w-3xl space-y-4 text-lg leading-relaxed text-white/75">
            {copy.pricing.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/pricing" className={yellowButton}>
              {copy.seePricing}
            </Link>
            <Link to="/school-pickup-board" className={ghostButton}>
              {copy.seeBoard}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-3xl font-bold">{copy.readingTitle}</h2>
        <p className="mt-3 max-w-3xl text-white/70">{copy.readingLede}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {copy.reads.map((item) => (
            <li key={item.href}>
              <Link
                to={item.href}
                className="block h-full rounded-2xl border border-white/10 bg-[#151a1a] p-5 transition hover:border-[#E9D500]/40"
              >
                <span className="font-semibold text-[#E9D500]">{item.title}</span>
                <span className="mt-2 block text-sm text-white/65">
                  {item.note}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-white/10 bg-[#121818]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-3xl font-bold">{copy.faqsTitle}</h2>
          <p className="mt-3 max-w-3xl text-white/70">{copy.faqsLede}</p>
          <div className="mt-8 space-y-4">
            {copy.faqs.map((item) => (
              <div
                key={item.q}
                className="rounded-2xl border border-white/10 bg-[#151a1a] p-5"
              >
                <h3 className="font-semibold text-[#E9D500]">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
          <Link to="/faqs" className={`${ghostButton} mt-8`}>
            {copy.seeFaqs}
          </Link>
        </div>
      </section>

      <section className="border-t border-white/10 py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">{copy.finalTitle}</h2>
            <p className="mt-2 max-w-xl text-white/65">{copy.finalBody}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/demo" className={demoButton}>
              {copy.bookDemo}
            </Link>
            <Link to="/signup?plan=car-line" className={yellowButton}>
              {copy.startTrial}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
