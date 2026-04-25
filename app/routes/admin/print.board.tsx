// Print route — DO NOT use the user's UI locale for translations.
// The board printout is posted publicly and read by anyone, so it follows
// `org.defaultLocale` (resolved server-side via `getOrgDefaultLocale`).
// Component-side, `usePrintLocale("board")` reads that resolved value
// from loader data; we then pass `lng` to `useTranslation("admin", { lng })`
// so the strings render in the chosen print locale even when the admin
// clicking Print has a different UI language.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/print.board";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { requireRole } from "~/sessions.server";
import { getOrgDefaultLocale } from "~/i18n.server";
import { usePrintLocale } from "~/hooks/usePrintLocale";

export const handle = { i18n: ["admin"] };

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

  // Print locale rule: board prints follow org default (audience is generic).
  const printLocale = getOrgDefaultLocale(context);

  return { spaces, fit, cols, printLocale };
}

export default function PrintBoard({ loaderData }: Route.ComponentProps) {
  const { spaces, fit, cols } = loaderData;
  const printLocale = usePrintLocale("board");
  const { t } = useTranslation("admin", { lng: printLocale });

  useEffect(() => {
    const tm = setTimeout(() => window.print(), 400);
    return () => clearTimeout(tm);
  }, []);

  const pageCss =
    fit === "page"
      ? `@page { size: letter landscape; margin: 0.4in; }
         html, body { height: 100%; margin: 0; }
         #root, #root > * { height: 100%; }`
      : `@page { size: letter landscape; margin: 0.4in; }`;

  return (
    <>
      <title>{t("print.board.title")}</title>
      <style>{pageCss}</style>
      <div
        lang={printLocale}
        className={
          fit === "page"
            ? "h-screen w-screen flex flex-col p-4 text-black bg-white font-sans print:h-[7.7in] print:w-[10.2in] print:p-0"
            : "p-4 text-black bg-white font-sans"
        }
      >
        <div className="flex items-baseline justify-between mb-2 print:mb-1">
          <h1 className="text-lg font-semibold">{t("print.board.title")}</h1>
          <div className="flex gap-3 text-xs print:hidden">
            <a
              className={fit === "page" ? "font-semibold underline" : "text-blue-600 hover:underline"}
              href="?fit=page"
            >
              {t("print.board.fitPage")}
            </a>
            <a
              className={fit === "grow" ? "font-semibold underline" : "text-blue-600 hover:underline"}
              href="?fit=grow"
            >
              {t("print.board.naturalSize")}
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
