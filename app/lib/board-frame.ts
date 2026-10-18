/**
 * Live-board frame. The header stays in normal flow at the top of the
 * 100dvh column.
 *
 * An earlier version put the header in an overflow frame and, on mount, set
 * `scrollTop` to the header height so the car-line tiles filled the viewport.
 * That moved the grid onto the Admin link's screen position: the click hit a
 * tile (or the empty grid on a new school) and never navigated. Typing
 * `/admin` still worked, because that never depended on the link.
 */
export const boardFrameClassName =
  "flex h-[100dvh] min-h-0 flex-col overflow-hidden";

/**
 * Board header links load with a real document navigation. That is the same
 * path as opening `/admin` directly, which works when a client-side
 * transition off the live board does not.
 */
export function boardHeaderLinkProps(documentNavigation: boolean): {
  reloadDocument?: true;
} {
  return documentNavigation ? { reloadDocument: true } : {};
}
