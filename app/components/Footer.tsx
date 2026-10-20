import { Link } from "react-router";
import { useTranslation } from "react-i18next";

type FooterProps = {
  siteName: string;
  supportEmail: string;
  orgName?: string | null;
};

export function Footer({ siteName, supportEmail, orgName }: FooterProps) {
  const { t } = useTranslation("common");
  return (
    <footer className="border-t border-white/10 py-8 px-4 bg-[#0f1414] text-white/80">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left column */}
        <div>
          <p className="font-bold text-white">{orgName || siteName}</p>
          <p className="text-sm mt-1 text-white/70">
            {t("footer.copyright", {
              year: new Date().getFullYear(),
              siteName,
            })}
          </p>
        </div>

        {/* Right column */}
        <nav className="flex flex-wrap gap-4 items-start text-sm">
          <Link to="/school-pickup-board" className="hover:text-white transition-colors">
            {t("footer.nav.pickupBoard")}
          </Link>
          <Link to="/pricing" className="hover:text-white transition-colors">
            {t("footer.nav.pricing")}
          </Link>
          <Link to="/blog" className="hover:text-white transition-colors">
            {t("footer.nav.blog")}
          </Link>
          <Link to="/guides" className="hover:text-white transition-colors">
            {t("footer.nav.guides")}
          </Link>
          <Link to="/faqs" className="hover:text-white transition-colors">
            {t("footer.nav.faqs")}
          </Link>
          <Link to="/contact" className="hover:text-white transition-colors">
            {t("footer.nav.contact")}
          </Link>
          <Link to="/demo" className="hover:text-white transition-colors">
            {t("footer.nav.demo")}
          </Link>
          <Link to="/login" className="hover:text-white transition-colors">
            {t("footer.nav.login")}
          </Link>
          <a
            href={`mailto:${supportEmail}`}
            className="hover:text-white transition-colors"
          >
            {t("footer.nav.support")}
          </a>
          <Link to="/status" className="hover:text-white transition-colors">
            {t("footer.nav.status")}
          </Link>
        </nav>

        <nav aria-label={t("footer.compare.heading")} className="text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
            {t("footer.compare.heading")}
          </p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/compare/pikmykid-alternatives" className="hover:text-white transition-colors">
                {t("footer.compare.pikmykid")}
              </Link>
            </li>
            <li>
              <Link to="/compare/schoolpass-vs-pickuproster" className="hover:text-white transition-colors">
                {t("footer.compare.schoolpass")}
              </Link>
            </li>
            <li>
              <Link to="/blog/best-school-dismissal-software" className="hover:text-white transition-colors">
                {t("footer.compare.dismissalSoftware")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
