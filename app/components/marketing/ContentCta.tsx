import { Link } from "react-router";
import { useTranslation } from "react-i18next";

const yellow =
  "inline-flex items-center justify-center rounded-xl bg-[#E9D500] px-4 py-2.5 text-sm font-semibold text-[#193B4B] transition hover:bg-[#f5e047]";
const ghost =
  "inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5";

/** Shared end-of-article links for blog posts and guides. */
export function ContentCta() {
  const { t } = useTranslation("common");
  return (
    <aside className="mt-14 rounded-2xl border border-[#E9D500]/30 bg-[#E9D500]/5 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#E9D500]">
        {t("contentCta.kicker")}
      </p>
      <h2 className="mt-2 text-2xl font-bold leading-snug">
        {t("contentCta.headline")}
      </h2>
      <p className="mt-3 text-base text-white/75">{t("contentCta.body")}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/school-pickup-board" className={yellow}>
          {t("contentCta.board")}
        </Link>
        <Link to="/pricing" className={ghost}>
          {t("contentCta.pricing")}
        </Link>
        <Link to="/demo" className={ghost}>
          {t("contentCta.demo")}
        </Link>
      </div>
    </aside>
  );
}
