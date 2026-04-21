import { Link } from "react-router";
import wordmark from "/logo-wordmark.svg?url";
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
  // Tenants that upload their own logo should still see it. Fall back to the
  // PickupRoster horizontal wordmark otherwise.
  const tenantLogo = branding?.logoUrl && branding.logoUrl !== "/logo-icon.svg"
    ? branding.logoUrl
    : null;

  return user ? (
    <div className="h-10 w-full flex items-center justify-center" style={{ backgroundColor: headerColor }}>
      <Link to="/" className="text-black font-bold inline-flex items-center">
        {tenantLogo ? (
          <>
            <img src={tenantLogo} alt={`${orgName} logo`} height={40} width={40} />
            {orgName} - Car Line Bingo
          </>
        ) : (
          <img src={wordmark} alt="PickupRoster" height={32} className="h-8 w-auto" />
        )}
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
        {tenantLogo ? (
          <>
            <img src={tenantLogo} alt={`${orgName} logo`} height={40} width={40} />
            {orgName} - Car Line Bingo
          </>
        ) : (
          <img src={wordmark} alt="PickupRoster" height={32} className="h-8 w-auto" />
        )}
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
