// Renders an actor's display name with optional impersonation suffix.
// "Noah Sundberg as Admin Account" when impersonating; just the name (or
// the fallback) otherwise. Shared by the loader (for the pre-composed
// `me.label`) and the activity / presence renderers on the client.
export function formatActorLabel(
  actorLabel: string | null,
  onBehalfOfLabel: string | null,
  fallback: string,
): string {
  const a = actorLabel?.trim();
  const o = onBehalfOfLabel?.trim();
  if (a && o) return `${a} as ${o}`;
  return a || o || fallback;
}
