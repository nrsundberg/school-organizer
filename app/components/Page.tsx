import Header from "~/components/Header";
import type { ReactNode } from "react";
import { useRouteLoaderData } from "react-router";

function MainPage({ children }: { children: ReactNode }) {
  return <div className="h-lvh"> {children}</div>;
}

export function Page({
  children,
  user
}: {
  children: ReactNode;
  user: boolean;
}) {
  const rootData = useRouteLoaderData("root") as
    | { branding?: { orgName?: string; primaryColor?: string; logoUrl?: string | null } }
    | undefined;
  return (
    <MainPage>
      <Header user={user} branding={rootData?.branding} />
      {children}
    </MainPage>
  );
}
