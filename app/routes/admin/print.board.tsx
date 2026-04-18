import { useEffect } from "react";
import type { Route } from "./+types/print.board";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { requireRole } from "~/sessions.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireRole(context, "ADMIN");
  const prisma = getTenantPrisma(context);
  const spaces = await prisma.space.findMany({
    orderBy: { spaceNumber: "asc" },
    select: { id: true, spaceNumber: true },
  });

  const url = new URL(request.url);
  const fit = url.searchParams.get("fit") === "grow" ? "grow" : "page";

  // Landscape letter usable area after 0.4" margins and header: ~10.2" x 7.0"
  // Pick cols that maximize square cell size inside that box.
  const n = spaces.length;
  const W = 10.2;
  const H = 7.0;
  const ratio = W / H;
  let cols = Math.max(1, Math.ceil(Math.sqrt(n * ratio)));
  // Sanity clamp
  cols = Math.min(cols, Math.max(n, 1));

  return { spaces, fit, cols };
}

export default function PrintBoard({ loaderData }: Route.ComponentProps) {
  const { spaces, fit, cols } = loaderData;

  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);

  const pageCss =
    fit === "page"
      ? `@page { size: letter landscape; margin: 0.4in; }
         html, body { height: 100%; margin: 0; }
         #root, #root > * { height: 100%; }`
      : `@page { size: letter landscape; margin: 0.4in; }`;

  return (
    <>
      <title>Car line bingo board (backup)</title>
      <style>{pageCss}</style>
      <div
        className={
          fit === "page"
            ? "h-screen w-screen flex flex-col p-4 text-black bg-white font-sans print:h-[7.7in] print:w-[10.2in] print:p-0"
            : "p-4 text-black bg-white font-sans"
        }
      >
        <div className="flex items-baseline justify-between mb-2 print:mb-1">
          <h1 className="text-lg font-semibold">Car line bingo board (backup)</h1>
          <div className="flex gap-3 text-xs print:hidden">
            <a
              className={fit === "page" ? "font-semibold underline" : "text-blue-600 hover:underline"}
              href="?fit=page"
            >
              Fit to one page
            </a>
            <a
              className={fit === "grow" ? "font-semibold underline" : "text-blue-600 hover:underline"}
              href="?fit=grow"
            >
              Natural size (multi-page)
            </a>
          </div>
        </div>
        <div
          className={
            fit === "page"
              ? "flex-1 grid gap-0 border border-black min-h-0"
              : "grid gap-0 border border-black"
          }
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            ...(fit === "grow"
              ? { gridAutoRows: "0.6in" }
              : {}),
          }}
        >
          {spaces.map((s) => (
            <div
              key={s.id}
              className="border border-black/60 text-[9px] leading-none p-1 flex items-start justify-start overflow-hidden"
            >
              {s.spaceNumber}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
