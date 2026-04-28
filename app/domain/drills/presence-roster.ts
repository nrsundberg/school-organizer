// Splits a presence map (keyed by socket id) into:
//   - authedRoster: signed-in users (entries with a non-null label), sorted
//     by `at` desc so the most-recently-active appears first.
//   - guestCount: anonymous viewer-pin guests (entries with label === null).
//     They have no identity, so we never expose their nonces — just a count.
//
// Pure / no React imports so it can be unit tested directly with node:test.
//
// The shape of `PresenceEntry` is duplicated from `drills.live.tsx` rather
// than imported, because `drills.live.tsx` is a route module and importing
// from it pulls in the loader/action and their server-side dependencies
// (Prisma, broadcast helpers, etc) into anything that imports the helper.
// Keeping the type local here avoids that and keeps the helper trivially
// importable from server tests.

export type RosterPresenceFocus =
  | { kind: "notes" }
  | { kind: "item"; id: string }
  | null;

export type RosterPresenceEntry = {
  userId: string;
  label: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfLabel: string | null;
  color: string;
  focus: RosterPresenceFocus;
  at: number;
};

export type RosterSplit = {
  authedRoster: RosterPresenceEntry[];
  guestCount: number;
};

export function splitPresenceRoster(
  entries: Iterable<RosterPresenceEntry>,
): RosterSplit {
  const authed: RosterPresenceEntry[] = [];
  let guestCount = 0;
  for (const e of entries) {
    if (e.label === null) {
      guestCount++;
    } else {
      authed.push(e);
    }
  }
  // Most-recently-active first; deterministic on tie via userId so the avatar
  // order doesn't reshuffle on every heartbeat.
  authed.sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at;
    return a.userId.localeCompare(b.userId);
  });
  return { authedRoster: authed, guestCount };
}
