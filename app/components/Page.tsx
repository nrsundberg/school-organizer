import Header from "~/components/Header";
import type { ReactNode } from "react";
import { useRouteLoaderData } from "react-router";

function MainPage({
  children,
  fitViewport,
}: {
  children: ReactNode;
  fitViewport?: boolean;
}) {
  // `fitViewport` turns the page into a fixed-height app frame: exactly one
  // dynamic viewport tall (dvh accounts for mobile browser chrome), header
  // pinned at the top, and the body region free to claim the rest via
  // `flex-1 min-h-0`. Used by the live board so it can fit on screen without
  // the whole page scrolling. Every other page keeps the growable `min-h-lvh`.
  if (fitViewport) {
    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden">{children}</div>
    );
  }
  return <div className="min-h-lvh"> {children}</div>;
}

export function Page({
  children,
  user,
  fitViewport
}: {
  children: ReactNode;
  user: boolean;
  fitViewport?: boolean;
}) {
  const rootData = useRouteLoaderData("root") as
    | { branding?: { orgName?: string; primaryColor?: string; logoUrl?: string | null } }
    | undefined;
  return (
    <MainPage fitViewport={fitViewport}>
      <Header user={user} branding={rootData?.branding} />
      {fitViewport ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      ) : (
        children
      )}
    </MainPage>
  );
}
