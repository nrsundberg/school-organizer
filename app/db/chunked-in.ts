/**
 * D1 caps the number of bound parameters per SQL statement. Cloudflare's
 * documented ceiling is 100; the engine accepts more in practice but is
 * not unlimited (we've observed failures around ~500). Any Prisma query
 * whose `IN (?, ?, …)` list scales with tenant size — including the
 * implicit `IN` Prisma generates when resolving an `include` relation —
 * will eventually overflow.
 *
 * Use these helpers any time a query's parameter count is not statically
 * bounded. The chunk size is deliberately conservative so a single chunk
 * always fits even when other `WHERE` conditions add a handful more vars
 * (e.g. the tenant extension's `orgId` filter).
 */

export const D1_IN_CHUNK_SIZE = 100;

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
