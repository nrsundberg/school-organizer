import { useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import { Send } from "lucide-react";
import { XCircleIcon } from "lucide-react";
import { type Space, Status } from "~/db/browser";
import LanguageSwitcher from "~/components/LanguageSwitcher";

const TIMEOUT_MS = 30000;

function isTimedOut(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() > TIMEOUT_MS;
}

export default function MobileCallerView({
  spaces,
  onSpaceChange,
  maxSpaceNumber: maxSpaceProp,
}: {
  spaces: Space[];
  onSpaceChange: (spaceNumber: number, status: string) => void;
  maxSpaceNumber: number;
}) {
  const { t } = useTranslation("roster");
  const maxSpaceNumber =
    maxSpaceProp > 0
      ? maxSpaceProp
      : spaces.length > 0
        ? Math.max(...spaces.map((s) => s.spaceNumber))
        : 300;
  const maxDigits = Math.max(1, String(maxSpaceNumber).length);
  const [input, setInput] = useState("");
  const fetcher = useFetcher();

  const activeSpaces = spaces
    .filter((s) => s.status === Status.ACTIVE)
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      return 0;
    })
    .slice(0, 20);

  const parsedNumber = parseInt(input);
  const isValid =
    !isNaN(parsedNumber) &&
    parsedNumber >= 1 &&
    parsedNumber <= maxSpaceNumber;
  const targetSpace = isValid ? spaces.find((s) => s.spaceNumber === parsedNumber) : null;
  const isActive = targetSpace?.status === Status.ACTIVE;

  const handleActivate = () => {
    if (!isValid) return;
    fetcher.submit(
      { space: parsedNumber },
      { method: "post", action: `update/${parsedNumber}` },
    );
    onSpaceChange(parsedNumber, "ACTIVE");
    setInput("");
  };

  const handleClear = (spaceNumber: number) => {
    fetcher.submit(
      { space: spaceNumber },
      { method: "post", action: `empty/${spaceNumber}` },
    );
    onSpaceChange(spaceNumber, "EMPTY");
  };

  const handleKeyPress = (digit: string) => {
    if (digit === "⌫") {
      setInput((prev) => prev.slice(0, -1));
    } else if (input.length < maxDigits) {
      setInput((prev) => prev + digit);
    }
  };

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-6 w-full max-w-sm mx-auto">
      {/* Language switcher — useful for callers who don't have a header
          chrome above this view (e.g. embedded keypad mode). Phase 2 may
          relocate this if/when the surrounding layout changes. */}
      <div className="w-full flex justify-end">
        <LanguageSwitcher placement="compact" />
      </div>
      {/* Display */}
      <div className="w-full bg-[#193B4B] rounded-xl p-4 text-center h-[100px] flex flex-col items-center justify-center">
        <div className="text-5xl font-extrabold text-white tracking-widest">
          {input || <span className="text-white/30">{t("caller.displayPlaceholder")}</span>}
        </div>
        {isValid && targetSpace && (
          <div className={`text-sm mt-1 font-semibold ${isActive ? "text-yellow-400" : "text-green-400"}`}>
            {isActive
              ? t("caller.alreadyActive", { spaceNumber: parsedNumber })
              : t("caller.spaceEmpty", { spaceNumber: parsedNumber })}
          </div>
        )}
        {input && !isValid && (
          <div className="text-sm mt-1 text-red-400">{t("caller.outOfRange", { max: maxSpaceNumber })}</div>
        )}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2 w-full">
        {keypad.map((key) => (
          <button
            key={key}
            onClick={() => {
              if (key === "✓") {
                handleActivate();
              } else {
                handleKeyPress(key);
              }
            }}
            disabled={key === "✓" && (!isValid || isActive)}
            className={`
              h-14 rounded-lg text-xl font-bold transition-all active:scale-95
              ${key === "✓"
                ? isValid && !isActive
                  ? "bg-[#E9D500] text-[#193B4B]"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
                : key === "⌫"
                  ? "bg-gray-600 text-white"
                  : "bg-[#193B4B] text-white hover:bg-[#1e4a5e]"}
            `}
          >
            {key === "✓" ? <Send className="mx-auto" /> : key}
          </button>
        ))}
      </div>

      {/* Recent active spaces */}
      {activeSpaces.length > 0 && (
        <div className="w-full">
          <p className="text-sm text-gray-400 mb-2 font-semibold uppercase tracking-wide">
            {t("caller.activeHeading")}
          </p>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {activeSpaces.map((space) => (
              <ActiveSpaceItem
                key={space.spaceNumber}
                space={space}
                onClear={handleClear}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveSpaceItem({
  space,
  onClear,
}: {
  space: Space;
  onClear: (spaceNumber: number) => void;
}) {
  const { t } = useTranslation("roster");
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!space.timestamp) return;
    const remaining = TIMEOUT_MS - (Date.now() - new Date(space.timestamp).getTime());
    if (remaining <= 0) return;
    const id = setTimeout(() => forceTick((t) => t + 1), remaining + 50);
    return () => clearTimeout(id);
  }, [space.timestamp]);

  const timedOut = isTimedOut(space.timestamp);
  const bg = timedOut ? "bg-green-400/20 border-green-400/40" : "bg-yellow-400/20 border-yellow-400/40";
  const icon = timedOut ? "text-green-400" : "text-yellow-400";
  const text = timedOut ? "text-green-300" : "text-yellow-300";
  const xIcon = timedOut ? "text-green-400/70" : "text-yellow-400/70";

  return (
    <Popover>
      <PopoverTrigger>
        <button
          className={`flex items-center justify-between ${bg} border rounded-lg px-4 py-3 text-left active:scale-95 transition-all w-full`}
        >
          <div className="flex items-center gap-3">
            <Send className={icon} />
            <span className={`font-bold ${text} text-lg`}>
              {t("caller.spaceLabel", { spaceNumber: space.spaceNumber })}
            </span>
          </div>
          <XCircleIcon size={20} className={xIcon} />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="px-1 py-2">
          <div className="text-small font-bold">{t("caller.markEmptyConfirm")}</div>
          <Button className="max-w-xs" variant="secondary" onPress={() => onClear(space.spaceNumber)}>
            {t("caller.markEmpty")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
