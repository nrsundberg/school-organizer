import Header from "~/components/Header";
import type { ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import { boardFrameClassName } from "~/lib/board-frame";

export function Page({
  children,
  user,
  fitViewport,
}: {
  children: ReactNode;
  user: boolean;
  fitViewport?: boolean;
}) {
  const rootData = useRouteLoaderData("root") as
    | { branding?: { orgName?: string; primaryColor?: string; logoUrl?: string | null } }
    | undefined;

  // On the live board the Admin / Profile links do a full document load.
  // See `boardHeaderLinkProps`.
  const header = (
    <Header
      user={user}
      branding={rootData?.branding}
      documentNavigation={!!fitViewport}
    />
  );

  // Every non-board page: growable document, header pinned at the top.
  if (!fitViewport) {
    return (
      <div className="min-h-lvh">
        {header}
        {children}
      </div>
    );
  }

  // Live board: header stays in the 100dvh column so Admin is on screen and
  // receives the click. The board fills whatever height is left.
  return (
    <div className={boardFrameClassName}>
      {header}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
