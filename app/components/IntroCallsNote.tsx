/**
 * Shared "two free intro calls" note. The booking link renders only when
 * `bookingUrl` is set. The default is the in-app /book/intro page.
 */
export function IntroCallsNote({
  heading,
  body,
  bookLabel,
  bookingUrl,
}: {
  heading: string;
  body: string;
  bookLabel: string;
  bookingUrl: string | null;
}) {
  return (
    <aside className="rounded-xl border border-[#E9D500]/30 bg-[#E9D500]/10 p-5 text-sm text-white/85">
      <h2 className="text-base font-semibold text-white">{heading}</h2>
      <p className="mt-2">{body}</p>
      {bookingUrl ? (
        <a
          href={bookingUrl}
          className="mt-3 inline-flex items-center rounded-lg bg-[#E9D500] px-3 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
          rel="noopener noreferrer"
          target="_blank"
        >
          {bookLabel}
        </a>
      ) : null}
    </aside>
  );
}
