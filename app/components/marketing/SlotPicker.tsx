import { useEffect, useMemo, useState } from "react";
import { formatSlotRange, safeTimeZone } from "~/domain/booking/rules";

export type SlotChoice = { start: string; end: string };

/**
 * Renders schedule instants in the visitor's timezone. The first paint uses
 * America/Denver so the server HTML matches, then the effect switches to
 * the browser zone and labels it.
 */
export function SlotPicker({
  slots,
  locale,
  legend,
  zoneLead,
  empty,
  name = "startsAt",
}: {
  slots: SlotChoice[];
  locale: string;
  legend: string;
  zoneLead: string;
  empty: string;
  name?: string;
}) {
  const [zone, setZone] = useState("America/Denver");
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setZone(safeTimeZone(detected));
  }, []);

  const groups = useMemo(() => {
    const byDay = new Map<string, { day: string; items: { start: string; time: string }[] }>();
    for (const slot of slots) {
      const label = formatSlotRange(new Date(slot.start), new Date(slot.end), zone, locale);
      const group = byDay.get(label.day) ?? { day: label.day, items: [] };
      group.items.push({ start: slot.start, time: label.time });
      byDay.set(label.day, group);
    }
    return [...byDay.values()];
  }, [slots, zone, locale]);

  const zoneName = formatSlotRange(
    new Date(slots[0]?.start ?? Date.now()),
    new Date(slots[0]?.end ?? Date.now() + 30 * 60_000),
    zone,
    locale,
  ).zone;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-white">{legend}</legend>
      <p className="text-sm text-white/60">
        {zoneLead} {zoneName} ({zone})
      </p>
      <input type="hidden" name="visitorTimeZone" value={zone} />
      {groups.length === 0 ? (
        <p className="text-sm text-white/70">{empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.day}>
            <p className="text-sm font-semibold text-[#E9D500]">{group.day}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.items.map((item) => (
                <label
                  key={item.start}
                  className="cursor-pointer rounded-xl border border-white/15 px-3 py-2 text-sm text-white/90 has-[:checked]:border-[#E9D500] has-[:checked]:bg-[#E9D500]/15"
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name={name}
                    value={item.start}
                    required
                  />
                  {item.time}
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </fieldset>
  );
}
