/**
 * @deprecated This module is replaced by `app/domain/csv/student-roster.server.ts`.
 *
 * Do NOT add new callers. The previous implementation had serious bugs:
 *  - `headerBody` silently dropped rows containing any blank cell
 *  - `convertToDataType` hard-coded `parseInt` at column index 2 regardless
 *    of the actual header in that slot
 *  - the split-on-comma parser broke on quoted commas ("O'Brien, Jr.")
 *  - no size cap, no row cap, no Zod validation of the parsed rows
 *  - dynamic object-key assignment from untrusted headers was
 *    prototype-pollution-adjacent
 *
 * See the P0-2 security finding. The new parser lives in
 * `~/domain/csv/student-roster.server` and is fully tested.
 *
 * This file is kept as an empty module only because the fuse-backed worktree
 * cannot unlink tracked files. On the next worktree/clone it can be deleted.
 */
export {};
