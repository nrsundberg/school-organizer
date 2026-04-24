import { Link } from "react-router";

type FooterProps = {
  siteName: string;
  supportEmail: string;
  orgName?: string | null;
};

export function Footer({ siteName, supportEmail, orgName }: FooterProps) {
  return (
    <footer className="border-t border-white/10 py-8 px-4 bg-[#0f1414] text-white/80">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left column */}
        <div>
          <p className="font-bold text-white">{orgName || siteName}</p>
          <p className="text-sm mt-1 text-white/70">
            &copy; {new Date().getFullYear()} {siteName}
          </p>
        </div>

        {/* Right column */}
        <nav className="flex flex-wrap gap-4 md:justify-end items-start text-sm">
          <Link to="/pricing" className="hover:text-white transition-colors">
            Pricing
          </Link>
          <Link to="/blog" className="hover:text-white transition-colors">
            Blog
          </Link>
          <Link to="/faqs" className="hover:text-white transition-colors">
            FAQs
          </Link>
          <Link to="/login" className="hover:text-white transition-colors">
            Login
          </Link>
          <a
            href={`mailto:${supportEmail}`}
            className="hover:text-white transition-colors"
          >
            Support
          </a>
          <Link to="/status" className="hover:text-white transition-colors">
            Status
          </Link>
        </nav>
      </div>
    </footer>
  );
}
