import Header from "~/components/Header";
import { useEffect, useRef, type ReactNode } from "react";
import { useRouteLoaderData } from "react-router";

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
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Live board only: on load, scroll the fixed header out of view so the
  // car-line tiles fill the viewport immediately. The header stays in the
  // document just above the fold — a wheel/swipe up reveals it (admin nav,
  // language, branding). `body.offsetTop` equals the header's height, so this
  // stays correct if the header ever changes size. Runs once on mount so a
  // deliberate scroll-up to the header isn't yanked back down by re-renders.
  useEffect(() => {
    const frame = frameRef.current;
    const body = bodyRef.current;
    if (!fitViewport || !frame || !body) return;
    frame.scrollTop = body.offsetTop;
  }, [fitViewport]);

  const header = <Header user={user} branding={rootData?.branding} />;

  // Every non-board page: growable document, header pinned at the top.
  if (!fitViewport) {
    return (
      <div className="min-h-lvh">
        {header}
        {children}
      </div>
    );
  }

  // `fitViewport` turns the page into a fixed app frame: a 100dvh scroll port
  // (dvh accounts for mobile browser chrome) holding the header above a 100dvh
  // board region. The only scrollable distance is the header's height, which the
  // effect above jumps past on load. Scrollbar hidden so that tiny track doesn't
  // render as a broken-looking near-full-height thumb; wheel/swipe still works.
  return (
    <div
      ref={frameRef}
      className="h-[100dvh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {header}
      <div ref={bodyRef} className="flex h-[100dvh] min-w-0 flex-col">
        {children}
      </div>
    </div>
  );
}
