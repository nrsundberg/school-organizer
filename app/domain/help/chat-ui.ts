export type HelpTurn = { role: "user" | "assistant"; content: string };

const REF_RE = /^[a-z][a-z0-9_]{0,63}$/i;

/**
 * A failed send must drop the optimistic user turn. Leaving it in place makes
 * the next post two user messages in a row, which the server rejects.
 */
export function restoreFailedChatSend<T>(prevTurns: readonly T[], draft: string): {
  turns: T[];
  draft: string;
} {
  return { turns: [...prevTurns], draft };
}

/** Small non-secret suffix for the unavailable message. */
export function helpErrorRef(
  code: string | undefined,
  upstreamType: string | undefined,
): string | null {
  if (!code || !code.startsWith("upstream_") || !REF_RE.test(code)) return null;
  const type = upstreamType && REF_RE.test(upstreamType) ? upstreamType : "";
  return type ? `(ref: ${code} ${type})` : `(ref: ${code})`;
}
