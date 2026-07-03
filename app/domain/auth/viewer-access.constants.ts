// Shared between the server (viewer-access.server.ts) and the admin UI
// (routes/admin/users.tsx). Kept in a non-`.server` module with no server-only
// imports so the route component can display the value without pulling the
// Prisma adapter chain into the client bundle.
//
// How long a viewer device stays signed in after redeeming a magic link (or
// PIN). Sized to cover a full school year — a link handed out at the start of
// the year keeps each faculty device signed in through to the end.
export const VIEWER_SESSION_DAYS = 300;
