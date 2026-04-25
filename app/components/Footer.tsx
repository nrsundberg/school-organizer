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
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
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
        <nav className="flex flex-wrap gap-4 md:justify-end items-start text-sm">
          <Link to="/pricing" className="hover:text-white transition-colors">
            {t("footer.nav.pricing")}
          </Link>
          <Link to="/blog" className="hover:text-white transition-colors">
            {t("footer.nav.blog")}
          </Link>
          <Link to="/faqs" className="hover:text-white transition-colors">
            {t("footer.nav.faqs")}
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
      </div>
    </footer>
  );
}
