import { Link } from "react-router";
import logo from "/favicon.ico?url";
import { DEFAULT_SITE_NAME } from "~/lib/site";

type HeaderBranding = {
  orgName?: string;
  primaryColor?: string;
  logoUrl?: string | null;
};

export default function ({
  user,
  branding,
}: {
  user: boolean;
  branding?: HeaderBranding;
}) {
  const orgName = branding?.orgName ?? DEFAULT_SITE_NAME;
  const headerColor = branding?.primaryColor ?? "#60A5FA";
  const logoSrc = branding?.logoUrl ?? logo;

  return user ? (
    <div className="h-10 w-full flex items-center justify-center" style={{ backgroundColor: headerColor }}>
      <Link to="/" className="text-black font-bold inline-flex items-center">
        <img src={logoSrc} alt={"school logo"} height={40} width={40} />
        {orgName} - Car Line Bingo
      </Link>
      <div className="inline-flex gap-2 absolute right-2">
        <Link
          className="border-1 border-black p-1 rounded-lg text-black"
          to="/admin"
        >
          Admin
        </Link>
        <Link
          className="border-1 border-black p-1 rounded-lg text-black"
          to="/logout"
        >
          Logout
        </Link>
      </div>
    </div>
  ) : (
    <div className="h-10 w-full flex items-center justify-center" style={{ backgroundColor: headerColor }}>
      <Link to="/" className="text-black font-bold inline-flex items-center">
        <img src={logoSrc} alt={"school logo"} height={40} width={40} />
        {orgName} - Car Line Bingo
      </Link>
      <Link
        className="border-1 border-black p-1 rounded-lg absolute right-2 text-black"
        to="/login"
      >
        Login
      </Link>
    </div>
  );
}
