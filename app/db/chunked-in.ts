/**
 * D1 caps the number of bound parameters per SQL statement at 100 (Cloudflare's
 * documented hard limit). Any Prisma query whose `IN (?, ?, …)` list scales with
 * tenant size — including the implicit `IN` Prisma generates when resolving an
 * `include` relation — will eventually overflow.
 *
 * Use these helpers any time a query's parameter count is not statically bounded.
 *
 * The chunk size MUST be strictly below the cap, because the bound params for
 * the `IN` list are not the only ones in the statement: the tenant extension
 * wraps every read in `AND: [where, { orgId }]` (+1 param), and call sites add
 * their own filters (e.g. `isActive`). A chunk size of exactly 100 overflowed
 * by one as soon as a chunk filled completely — the duplicates page, with
 * hundreds of involved households, hit this on its very first chunk (#68 set
 * the size to the cap; this leaves headroom instead).
 */

export const D1_MAX_BOUND_PARAMS = 100;

/** Headroom for params D1 adds beyond the IN list (orgId + a couple call-site filters). */
const RESERVED_PARAMS = 10;

export const D1_IN_CHUNK_SIZE = D1_MAX_BOUND_PARAMS - RESERVED_PARAMS;

export function chunk<T>(
  items: readonly T[],
  chunkSize: number = D1_IN_CHUNK_SIZE,
): T[][] {
  if (chunkSize <= 0) {
    throw new Error(`chunk size must be positive, got ${chunkSize}`);
  }
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize) as T[]);
  }
  return chunks;
}

export async function chunkedFindMany<TId, TRow>(
  ids: readonly TId[],
  runChunk: (idChunk: TId[]) => PromiseLike<readonly TRow[]>,
  chunkSize: number = D1_IN_CHUNK_SIZE,
): Promise<TRow[]> {
  if (ids.length === 0) return [];
  const out: TRow[] = [];
  for (const idChunk of chunk(ids, chunkSize)) {
    const rows = await runChunk(idChunk);
    out.push(...rows);
  }
  return out;
}

export function groupBy<T, K>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}
