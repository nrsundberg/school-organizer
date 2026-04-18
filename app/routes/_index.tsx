import { Page } from "~/components/Page";
import { useFetcher, useSearchParams } from "react-router";
import { type Space, Status } from "~/db/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Send } from "lucide-react";
import type { Route } from "./+types/_index";
import { getTenantPrisma, getOptionalUserFromContext } from "~/domain/utils/global-context.server";
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

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Tome Car Bingo" },
    { name: "description", content: "Tome School car line!" }
  ];
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  const user = getOptionalUserFromContext(context);
  const filterRooms = new URL(request.url).searchParams.get("room");

  const [spaces, homeRooms, recentCars, appSettings] = await Promise.all([
    prisma.space.findMany({ orderBy: { spaceNumber: "asc" } }),
    prisma.teacher.findMany({ orderBy: { homeRoom: "asc" } }),
    prisma.callEvent.findMany({
      where: {
        studentId: { not: null },
        homeRoomSnapshot: filterRooms ? { in: filterRooms.split(",") } : undefined,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20
    }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
  ]);

  const role = user?.role ?? null;
  const permitted = role === "CONTROLLER";
  const maxSpaceNumber =
    spaces.length > 0 ? Math.max(...spaces.map((s) => s.spaceNumber)) : 0;
  const viewerDrawingEnabled = appSettings?.viewerDrawingEnabled ?? false;

  return {
    permitted,
    role,
    user: !!user,
    spaces,
    homeRooms,
    recentCars,
    controllerViewPreference: user?.controllerViewPreference ?? null,
    viewerDrawingEnabled,
    maxSpaceNumber,
  };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    homeRooms,
    recentCars: initialRecentCars,
    permitted,
    role,
    user,
    controllerViewPreference,
    viewerDrawingEnabled,
    maxSpaceNumber,
  } = loaderData;

  // Local spaces state — initialized from loader, updated by WebSocket
  const [spaces, setSpaces] = useState(loaderData.spaces);
  const [recentCars, setRecentCars] = useState(initialRecentCars);
  const [homeroomFilter, setHomeroomFilter] = useState(searchParams.get("room") ?? "");

  // Keep spaces in sync if loader data changes (e.g. after revalidation on WS reconnect)
  useEffect(() => {
    setSpaces(loaderData.spaces);
  }, [loaderData.spaces]);

  useEffect(() => {
    setRecentCars(initialRecentCars);
  }, [initialRecentCars]);

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
            toast(`Space ${spaceNumber} is now active!`, { type: "info", theme: "dark" });
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
        orgId: (event as { orgId?: string }).orgId ?? "",
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

  const cols = permitted ? 10 : 15;
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
      <p className="mb-1 text-sm text-gray-400">Filter Homeroom</p>
      <input
        value={homeroomFilter}
        list="homepage-homeroom-options"
        onChange={(e) => {
          const value = e.target.value;
          setHomeroomFilter(value);
          updateRoomFilter(value);
        }}
        placeholder="Homeroom..."
        className="w-full rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 [color-scheme:dark] focus:border-primary focus:outline-none"
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
      Most Recent Queue
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

  // Controllers see a tabbed view: keypad or board (default board; preference persisted)
  if (role === "CONTROLLER") {
    return (
      <Page user={user}>
        <ControllerTabView
          spaces={spaces}
          onSpaceChange={handleSpaceChange}
          initialPreference={controllerViewPreference}
          maxSpaceNumber={maxSpaceNumber}
        />
      </Page>
    );
  }

  // Admins see the caller view on mobile, full grid on desktop
  // Viewers (and logged-out users) see just the board
  return (
    <Page user={user}>
      {permitted ? (
        <div className="flex justify-center">
          {/* Admin mobile caller view */}
          <div className="md:hidden w-full">
            <MobileCallerView
              spaces={spaces}
              onSpaceChange={handleSpaceChange}
              maxSpaceNumber={maxSpaceNumber}
            />
          </div>

          {/* Grid — admins see on desktop only */}
          <div
            className="hidden w-full md:grid md:w-5/6 font-extrabold text-large text-center relative"
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
              permitted={true}
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
                    Clear ({drawPoints.length})
                  </button>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:flex-row md:justify-center md:gap-0">
          {/* Viewer mobile controls: homeroom selector + recent queue above grid */}
          <div className="w-full px-4 pt-3 text-center md:hidden">
            {homeroomFilterControl}
            {recentQueueContent}
          </div>

          {/* Viewer board */}
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
                    Clear ({drawPoints.length})
                  </button>
                )}
              </>
            ) : null}
          </div>

          {/* Viewer desktop sidebar */}
          <div className="hidden h-[80vh] gap-3 py-2 text-center md:block">
            <div className="max-w-xs px-4 pt-4">{homeroomFilterControl}</div>
            {recentQueueContent}
          </div>
        </div>
      )}
    </Page>
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
          Board
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
          Controller
        </button>
      </div>

      {tab === "controller" ? (
        <MobileCallerView
          spaces={spaces}
          onSpaceChange={onSpaceChange}
          maxSpaceNumber={maxSpaceNumber}
        />
      ) : (
        <div className="w-full font-extrabold text-large text-center">
          <ParkingRows data={spaces} cols={10} permitted={true} compact />
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

  const commonClasses = `border border-black flex items-center justify-center drop-shadow-sm select-none ${compact ? "min-h-[24px] text-[10px] px-0 leading-none" : "min-h-[30px] text-sm px-0.5 leading-none"}`;

  return permitted ? (
    status === Status.EMPTY ? (
      <div data-space={spaceNumber} className={`${color} ${commonClasses}`} onClick={() => updateToActive(spaceNumber)}>
        {spaceNumber}
      </div>
    ) : (
      status === Status.ACTIVE && (
        <Popover>
          <PopoverTrigger>
            <div data-space={spaceNumber} className={`${color} ${commonClasses}`}>
              <Send />
              {spaceNumber}
            </div>
          </PopoverTrigger>
          <PopoverContent>
            <div className="px-1 py-2">
              <div className="text-small font-bold">Mark this spot empty?</div>
              <Button className="max-w-xs" variant="secondary" onPress={() => updateToEmpty(spaceNumber)}>
                Mark Empty
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
      className={`${color} ${commonClasses} w-full ${onDrawingSpace ? "cursor-crosshair opacity-95" : ""}`}
      onClick={() => onDrawingSpace?.(spaceNumber)}
    >
      {status === Status.ACTIVE && <Send />}
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
