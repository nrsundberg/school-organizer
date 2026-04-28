import { MarketingLanding } from "~/components/marketing/MarketingLanding";
import { Page } from "~/components/Page";
import { useFetcher, useSearchParams, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { type Space, Status } from "~/db/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Megaphone, Send } from "lucide-react";
import type { Route } from "./+types/_index";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["roster"] };
import { isMarketingHost } from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import {
  getTenantPrisma,
  getOptionalOrgFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";
import { DEFAULT_SITE_NAME } from "~/lib/site";
import {
  Button,
  Separator,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@heroui/react";
import { useBingoWebSocket } from "~/hooks/useBingoWebSocket";
import MobileCallerView from "~/components/MobileCallerView";
import confetti from "canvas-confetti";
import { endOfUtcDay, toDateInputValue } from "~/domain/dismissal/schedule";

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data || data.mode === "marketing") {
    return [
      { title: data?.metaTitle ?? `${DEFAULT_SITE_NAME} — Car line made clear` },
      { name: "description", content: data?.metaDescription ?? "Live car line board, viewer access, and school admin tools." },
    ];
  }
  return [
    { title: data.metaTitle },
    { name: "description", content: data.metaDescription },
  ];
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "roster");

  if (isMarketingHost(request, context)) {
    // If a logged-in user with an org visits the marketing home, send them
    // straight to their tenant board. Edge cases (no org) fall through to
    // the marketing page. Only triggered on "/" — other marketing pages
    // (/pricing, /faqs) render normally so users can still browse.
    const user = getOptionalUserFromContext(context);
    if (user?.orgId) {
      const url = await getTenantBoardUrlForRequest(request, context);
      if (url) throw redirect(url);
    }
    return {
      mode: "marketing" as const,
      metaTitle: t("index.metaTitle", { name: DEFAULT_SITE_NAME }),
      metaDescription: t("index.metaDescription"),
    };
  }

  const org = getOptionalOrgFromContext(context);
  if (!org) {
    const u = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(`${u.pathname}${u.search}`)}`);
  }

  const prisma = getTenantPrisma(context);
  const user = getOptionalUserFromContext(context);
  const filterRoomsParam = new URL(request.url).searchParams.get("room");
  // Cap the room filter list: this query string is attacker-controllable
  // and feeds an `IN (?, …)` clause. 50 is well above any realistic
  // homeroom count and well below D1's per-statement variable limit.
  const filterRoomList = filterRoomsParam
    ? filterRoomsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50)
    : null;

  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [spaces, homeRooms, recentCars, appSettings, programCancellations] = await Promise.all([
    prisma.space.findMany({ orderBy: { spaceNumber: "asc" } }),
    prisma.teacher.findMany({ orderBy: { homeRoom: "asc" } }),
    prisma.callEvent.findMany({
      where: {
        studentId: { not: null },
        homeRoomSnapshot:
          filterRoomList && filterRoomList.length > 0
            ? { in: filterRoomList }
            : undefined,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20
    }),
    prisma.appSettings.findFirst(),
    prisma.programCancellation.findMany({
      where: {
        cancellationDate: {
          gte: todayStart,
          lte: endOfUtcDay(todayStart),
        },
      },
      include: {
        program: { select: { name: true } },
      },
      orderBy: [{ cancellationDate: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const role = user?.role ?? null;
  const maxSpaceNumber =
    spaces.length > 0 ? Math.max(...spaces.map((s) => s.spaceNumber)) : 0;
  const viewerDrawingEnabled = appSettings?.viewerDrawingEnabled ?? false;

  return {
    mode: "tenant" as const,
    orgName: org.name,
    role,
    user: !!user,
    spaces,
    homeRooms,
    recentCars,
    programCancellations: programCancellations.map((notice) => ({
      id: notice.id,
      programName: notice.program.name,
      cancellationDate: toDateInputValue(notice.cancellationDate),
      title: notice.title,
      message: notice.message,
    })),
    controllerViewPreference: user?.controllerViewPreference ?? null,
    viewerDrawingEnabled,
    maxSpaceNumber,
    metaTitle: t("index.tenantMetaTitle", { orgName: org.name }),
    metaDescription: t("index.tenantMetaDescription", { orgName: org.name }),
  };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  if (loaderData.mode === "marketing") {
    return <MarketingLanding />;
  }

  return <TenantCarLineHome loaderData={loaderData} />;
}

function TenantCarLineHome({ loaderData }: { loaderData: Exclude<Route.ComponentProps["loaderData"], { mode: "marketing" }> }) {
  const { t } = useTranslation("roster");
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    homeRooms,
    recentCars: initialRecentCars,
    programCancellations: initialProgramCancellations,
    role,
    user,
    controllerViewPreference,
    viewerDrawingEnabled,
    maxSpaceNumber,
  } = loaderData;

  // Local spaces state — initialized from loader, updated by WebSocket
  const [spaces, setSpaces] = useState(loaderData.spaces);
  const [recentCars, setRecentCars] = useState(initialRecentCars);
  const [programCancellations, setProgramCancellations] = useState(initialProgramCancellations);
  const [homeroomFilter, setHomeroomFilter] = useState(searchParams.get("room") ?? "");

  // Keep spaces in sync if loader data changes (e.g. after revalidation on WS reconnect)
  useEffect(() => {
    setSpaces(loaderData.spaces);
  }, [loaderData.spaces]);

  useEffect(() => {
    setRecentCars(initialRecentCars);
  }, [initialRecentCars]);

  useEffect(() => {
    setProgramCancellations(initialProgramCancellations);
  }, [initialProgramCancellations]);

  useEffect(() => {
    setHomeroomFilter(searchParams.get("room") ?? "");
  }, [searchParams]);

  useBingoWebSocket({
    onSpaceUpdate: ({ spaceNumber, status, timestamp }) => {
      setSpaces((prev) =>
        prev.map((s) =>
          s.spaceNumber === spaceNumber
            ? { ...s, status: status as Status, timestamp: timestamp ?? null }
            : s
        )
      );
      if (status === Status.ACTIVE) {
        const el = document.querySelector(`[data-space="${spaceNumber}"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const visible =
            rect.top >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
          if (!visible) {
            toast(t("index.spaceNowActive", { spaceNumber }), { type: "info", theme: "dark" });
          }
        }
      }
    },
    onCallEvent: ({ event }) => {
      if (event.studentId == null) {
        return;
      }
      setRecentCars((prev) => [{
        ...event,
        createdAt: new Date(event.createdAt),
      }, ...prev].slice(0, 20));
    },
    onBoardReset: () => {
      setSpaces((prev) =>
        prev.map((space) => ({
          ...space,
          status: Status.EMPTY,
          timestamp: null,
        }))
      );
      setRecentCars([]);
    },
    onProgramCancellation: ({ cancellation }) => {
      toast(cancellation.title, { type: "warning", theme: "dark" });
      setProgramCancellations((prev) => {
        if (prev.some((notice) => notice.id === cancellation.id)) return prev;
        return [cancellation, ...prev];
      });
    },
  });

  const handleSpaceChange = (spaceNumber: number, status: string) => {
    setSpaces((prev) =>
      prev.map((s) =>
        s.spaceNumber === spaceNumber
          ? { ...s, status: status as Status, timestamp: status === "ACTIVE" ? new Date().toISOString() : null }
          : s
      )
    );
  };

  const updateRoomFilter = (value: string) => {
    const normalized = value.trim();
    const isKnownRoom = homeRooms.some((room) => room.homeRoom === normalized);
    setSearchParams((prev) => {
      if (normalized === "" || !isKnownRoom) {
        prev.delete("room");
      } else {
        prev.set("room", normalized);
      }
      return prev;
    });
  };

  // Non-controller render path (controllers return early below into
  // ControllerTabView, which manages its own columns) — read-only board
  // for admins, viewers, and logged-out users.
  const cols = 15;
  const showViewerDrawing =
    viewerDrawingEnabled && (role === "VIEWER" || !user);
  const drawStorageKey = `tome-draw-${cols}-${spaces.map((s) => s.spaceNumber).join(",")}`;

  const [drawPoints, setDrawPoints] = useState<number[]>([]);

  useEffect(() => {
    if (!showViewerDrawing) return;
    try {
      const raw = localStorage.getItem(drawStorageKey);
      if (raw) setDrawPoints(JSON.parse(raw) as number[]);
    } catch {
      setDrawPoints([]);
    }
  }, [showViewerDrawing, drawStorageKey]);

  useEffect(() => {
    if (!showViewerDrawing) return;
    localStorage.setItem(drawStorageKey, JSON.stringify(drawPoints));
  }, [drawPoints, showViewerDrawing, drawStorageKey]);

  const handleDrawingSpace = useCallback((spaceNumber: number) => {
    setDrawPoints((prev) => {
      if (prev.length && prev[prev.length - 1] === spaceNumber) return prev;
      if (prev.length >= 2 && spaceNumber === prev[0]) {
        confetti({ particleCount: 64, spread: 58, origin: { y: 0.65 } });
        return [];
      }
      return [...prev, spaceNumber];
    });
  }, []);

  const clearDrawing = useCallback(() => setDrawPoints([]), []);

  const isDrawingRef = useRef(false);
  const getSpaceAtPoint = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const spaceEl = (el as Element | null)?.closest?.("[data-space]") as HTMLElement | null;
    if (!spaceEl) return null;
    const v = Number(spaceEl.dataset.space);
    return Number.isFinite(v) ? v : null;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!showViewerDrawing) return;
    isDrawingRef.current = true;
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    const sn = getSpaceAtPoint(e.clientX, e.clientY);
    if (sn != null) handleDrawingSpace(sn);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const sn = getSpaceAtPoint(e.clientX, e.clientY);
    if (sn != null) handleDrawingSpace(sn);
  };
  const onPointerEnd = () => {
    isDrawingRef.current = false;
  };

  const homeroomFilterControl = (
    <div className="text-left">
      <label
        htmlFor="homepage-homeroom"
        className="mb-1 block text-sm text-gray-300"
      >
        {t("index.filterHomeroom")}
      </label>
      <input
        id="homepage-homeroom"
        value={homeroomFilter}
        list="homepage-homeroom-options"
        onChange={(e) => {
          const value = e.target.value;
          setHomeroomFilter(value);
          updateRoomFilter(value);
        }}
        placeholder={t("index.homeroomPlaceholder")}
        className="w-full app-field [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-[#E9D500]"
      />
      <datalist id="homepage-homeroom-options">
        {homeRooms.map((room) => (
          <option
            key={room.homeRoom}
            value={room.homeRoom}
            className="bg-gray-900 text-white"
          />
        ))}
      </datalist>
    </div>
  );

  const recentQueueContent = (
    <div className="py-3">
      {t("index.recentQueue")}
      <Separator className={"my-3"} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm md:grid-cols-1 md:text-base">
        {recentCars.map(
          (event: {
            id: number;
            studentName: string;
            homeRoomSnapshot: string | null;
            spaceNumber: number;
          }) => (
            <div key={event.id}>
              {event.studentName}
            </div>
          )
        )}
      </div>
    </div>
  );

  const noticePanel = <ProgramCancellationBanner notices={programCancellations} />;

  // Controllers see a tabbed view: keypad or board (default board; preference persisted)
  if (role === "CONTROLLER") {
    return (
      <Page user={user}>
        {noticePanel}
        <ControllerTabView
          spaces={spaces}
          onSpaceChange={handleSpaceChange}
          initialPreference={controllerViewPreference}
          maxSpaceNumber={maxSpaceNumber}
        />
      </Page>
    );
  }

  // Everyone else (admins, viewers, logged-out) gets the read-only board.
  // Admins are intentionally not given click-to-mark — managing the roster
  // ≠ running it; only CONTROLLERs (or platform-admin user-impersonation of
  // a controller) can actually mark tiles, gated server-side in
  // /update/:space and /empty/:space.
  return (
    <Page user={user}>
      {noticePanel}
      <div className="flex flex-col gap-3 md:flex-row md:justify-center md:gap-0">
        {/* Mobile controls: homeroom selector + recent queue above grid */}
        <div className="w-full px-4 pt-3 text-center md:hidden">
          {homeroomFilterControl}
          {recentQueueContent}
        </div>

        {/* Read-only board */}
        <div
          className="grid w-full font-extrabold text-large text-center relative md:w-5/6"
          onPointerDown={showViewerDrawing ? onPointerDown : undefined}
          onPointerMove={showViewerDrawing ? onPointerMove : undefined}
          onPointerUp={showViewerDrawing ? onPointerEnd : undefined}
          onPointerCancel={showViewerDrawing ? onPointerEnd : undefined}
          onPointerLeave={showViewerDrawing ? onPointerEnd : undefined}
          style={showViewerDrawing ? { touchAction: "none" } : undefined}
        >
          <ParkingRows
            data={spaces}
            cols={cols}
            permitted={false}
            onDrawingSpace={showViewerDrawing ? handleDrawingSpace : undefined}
          />
          {showViewerDrawing ? (
            <>
              <ViewerDrawingOverlay spaces={spaces} cols={cols} points={drawPoints} />
              {drawPoints.length > 0 && (
                <button
                  type="button"
                  onClick={clearDrawing}
                  className="absolute bottom-2 right-2 z-20 text-xs bg-black/60 text-white px-2 py-1 rounded hover:bg-black/80"
                >
                  {t("index.drawing.clear", { count: drawPoints.length })}
                </button>
              )}
            </>
          ) : null}
        </div>

        {/* Desktop sidebar */}
        <div className="hidden h-[80vh] gap-3 py-2 text-center md:block">
          <div className="max-w-xs px-4 pt-4">{homeroomFilterControl}</div>
          {recentQueueContent}
        </div>
      </div>
    </Page>
  );
}

function ProgramCancellationBanner({
  notices,
}: {
  notices: {
    id: string;
    programName: string;
    cancellationDate: string;
    title: string;
    message: string;
  }[];
}) {
  if (notices.length === 0) return null;

  return (
    <div className="mx-auto my-3 flex w-[min(96vw,980px)] flex-col gap-2 rounded-xl border border-amber-300/40 bg-amber-300/15 p-4 text-amber-50 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-200">
        <Megaphone className="h-4 w-4" />
        Program cancellation notice
      </div>
      {notices.map((notice) => (
        <div key={notice.id} className="rounded-lg bg-black/20 p-3">
          <p className="font-semibold text-white">{notice.title}</p>
          <p className="text-sm text-amber-100/90">
            {notice.programName} · {notice.cancellationDate}
          </p>
          <p className="mt-1 text-sm text-white/80">{notice.message}</p>
        </div>
      ))}
    </div>
  );
}

function ControllerTabView({
  spaces,
  onSpaceChange,
  initialPreference,
  maxSpaceNumber,
}: {
  spaces: Space[];
  onSpaceChange: (spaceNumber: number, status: string) => void;
  initialPreference: string | null;
  maxSpaceNumber: number;
}) {
  const { t } = useTranslation("roster");
  const fetcher = useFetcher();
  const defaultTab = initialPreference === "controller" ? "controller" : "board";
  const [tab, setTab] = useState<"controller" | "board">(defaultTab);

  useEffect(() => {
    setTab(initialPreference === "controller" ? "controller" : "board");
  }, [initialPreference]);

  const persist = (next: "controller" | "board") => {
    setTab(next);
    fetcher.submit(
      { controllerViewPreference: next === "board" ? "board" : "controller" },
      { method: "post", action: "/api/user-prefs" }
    );
  };

  return (
    <div className="flex flex-col w-full">
      <div className="flex border-b border-white/10 mb-4">
        <button
          type="button"
          onClick={() => persist("board")}
          className={`px-5 py-2 text-sm font-semibold transition-colors ${
            tab === "board"
              ? "border-b-2 border-[#E9D500] text-[#E9D500]"
              : "text-white/50 hover:text-white"
          }`}
        >
          {t("index.tabs.board")}
        </button>
        <button
          type="button"
          onClick={() => persist("controller")}
          className={`px-5 py-2 text-sm font-semibold transition-colors ${
            tab === "controller"
              ? "border-b-2 border-[#E9D500] text-[#E9D500]"
              : "text-white/50 hover:text-white"
          }`}
        >
          {t("index.tabs.controller")}
        </button>
      </div>

      {tab === "controller" ? (
        <MobileCallerView
          spaces={spaces}
          onSpaceChange={onSpaceChange}
          maxSpaceNumber={maxSpaceNumber}
        />
      ) : (
        <div className="flex justify-center">
          <div className="grid w-full md:w-5/6 font-extrabold text-large text-center">
            <ParkingRows data={spaces} cols={10} permitted={true} />
          </div>
        </div>
      )}
    </div>
  );
}

function ParkingRows({
  data,
  cols,
  permitted,
  compact = false,
  onDrawingSpace,
}: {
  cols: number;
  data: Space[];
  permitted: boolean;
  compact?: boolean;
  onDrawingSpace?: (spaceNumber: number) => void;
}) {
  const newData = [];
  for (let i = 0; i < data.length; i += cols) {
    newData.push(data.slice(i, i + cols));
  }
  return newData.map((it, index) => (
    <ParkingRow
      key={index}
      data={it}
      cols={cols}
      permitted={permitted}
      compact={compact}
      onDrawingSpace={onDrawingSpace}
    />
  ));
}

function ParkingRow({
  data,
  cols,
  permitted,
  compact = false,
  onDrawingSpace,
}: {
  cols: number;
  data: Space[];
  permitted: boolean;
  compact?: boolean;
  onDrawingSpace?: (spaceNumber: number) => void;
}) {
  const columnClass =
    cols === 10 ? "grid-cols-10" : cols === 15 ? "grid-cols-15" : "";
  return (
    <div
      className={columnClass ? `grid ${columnClass}` : "grid"}
      style={
        columnClass
          ? undefined
          : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
      }
    >
      {data.map((it) => (
        <ParkingTile
          key={`${it.id}-${it.status}`}
          space={it}
          permitted={permitted}
          compact={compact}
          onDrawingSpace={onDrawingSpace}
        />
      ))}
    </div>
  );
}

const TIMEOUT_MS = 30000;

function ParkingTile({
  space,
  permitted,
  compact = false,
  onDrawingSpace,
}: {
  space: Space;
  permitted: boolean;
  compact?: boolean;
  onDrawingSpace?: (spaceNumber: number) => void;
}) {
  const { t } = useTranslation("roster");
  const { timestamp, status, spaceNumber } = space;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status !== Status.ACTIVE || !timestamp) return;
    const remaining = TIMEOUT_MS - (Date.now() - new Date(timestamp).getTime());
    if (remaining <= 0) return;
    const id = setTimeout(() => forceTick((t) => t + 1), remaining + 50);
    return () => clearTimeout(id);
  }, [status, timestamp]);
  const color = tileColor(status, isTimedOut(status, timestamp));

  const fetcher = useFetcher();

  const updateToActive = (spaceNumber: number) => {
    fetcher.submit({ space: spaceNumber }, { method: "post", action: `update/${spaceNumber}` });
  };

  const updateToEmpty = (spaceNumber: number) => {
    fetcher.submit({ space: spaceNumber }, { method: "post", action: `empty/${spaceNumber}` });
  };

  // Non-compact tiles get a larger touch target on small screens (WCAG 2.5.5 — 44x44).
  // Compact view is for the controller board, which is densely packed for quick scan.
  const commonClasses = `w-full border border-black flex items-center justify-center drop-shadow-sm select-none ${compact ? "min-h-[24px] text-[10px] px-0 leading-none" : "min-h-[44px] md:min-h-[30px] text-sm px-0.5 leading-none"}`;

  return permitted ? (
    status === Status.EMPTY ? (
      <button
        type="button"
        data-space={spaceNumber}
        aria-label={t("index.tile.ariaEmpty", { spaceNumber })}
        className={`${color} ${commonClasses} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500] focus-visible:z-10`}
        onClick={() => updateToActive(spaceNumber)}
      >
        {spaceNumber}
      </button>
    ) : (
      status === Status.ACTIVE && (
        <Popover>
          <PopoverTrigger>
            <button
              type="button"
              data-space={spaceNumber}
              aria-label={t("index.tile.ariaActive", { spaceNumber })}
              className={`${color} ${commonClasses} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500] focus-visible:z-10`}
            >
              <Send aria-hidden="true" />
              {spaceNumber}
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="px-1 py-2">
              <div className="text-small font-bold">{t("index.popover.markEmptyConfirm")}</div>
              <Button className="max-w-xs" variant="secondary" onPress={() => updateToEmpty(spaceNumber)}>
                {t("index.popover.markEmpty")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )
    )
  ) : (
    <button
      type="button"
      data-space={spaceNumber}
      aria-label={status === Status.ACTIVE ? t("index.tile.ariaViewerActive", { spaceNumber }) : t("index.tile.ariaViewerEmpty", { spaceNumber })}
      className={`${color} ${commonClasses} w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500] focus-visible:z-10 ${onDrawingSpace ? "cursor-crosshair opacity-95" : ""}`}
      onClick={() => onDrawingSpace?.(spaceNumber)}
    >
      {status === Status.ACTIVE && <Send aria-hidden="true" />}
      {spaceNumber}
    </button>
  );
}

function ViewerDrawingOverlay({
  spaces,
  cols,
  points,
}: {
  spaces: Space[];
  cols: number;
  points: number[];
}) {
  if (points.length === 0) return null;
  const rows = Math.max(1, Math.ceil(spaces.length / cols));
  const toXY = (spaceNumber: number): [number, number] | null => {
    const idx = spaces.findIndex((s) => s.spaceNumber === spaceNumber);
    if (idx < 0) return null;
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const x = ((col + 0.5) / cols) * 100;
    const y = ((row + 0.5) / rows) * 100;
    return [x, y];
  };
  const pairs = points
    .map((sn) => toXY(sn))
    .filter((p): p is [number, number] => p !== null);
  if (pairs.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {pairs.length >= 2 && (
        <polyline
          fill="none"
          stroke="rgba(255, 60, 60, 0.9)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={pairs.map(([x, y]) => `${x} ${y}`).join(" ")}
        />
      )}
      {pairs.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={0.8}
          fill="rgba(255, 60, 60, 0.95)"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function isTimedOut(status: Status, timestamp: string | null): boolean {
  if (status !== Status.ACTIVE || !timestamp) return false;
  return new Date().getTime() - new Date(timestamp).getTime() > TIMEOUT_MS;
}

function tileColor(status: Status, timedOut?: boolean) {
  switch (status) {
    case "ACTIVE":
      return timedOut
        ? "bg-green-200 text-black rounded-small flex items-center"
        : "bg-[#E9D500] text-[#193B4B] rounded-small flex items-center justify-center";
    case "EMPTY":
      return "bg-[#193B4B] text-white";
  }
}
