import test from "node:test";
import assert from "node:assert/strict";
import { D1_IN_CHUNK_SIZE, chunk, chunkedFindMany, groupBy } from "./chunked-in";

test("chunk returns empty array for empty input", () => {
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk([], 5), []);
});

test("chunk splits into equal-sized chunks", () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test("chunk handles trailing partial chunk", () => {
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

test("chunk fits in one bucket when smaller than size", () => {
  assert.deepEqual(chunk([1, 2], 5), [[1, 2]]);
});

test("chunk uses D1_IN_CHUNK_SIZE by default", () => {
  const items = Array.from({ length: D1_IN_CHUNK_SIZE + 1 }, (_, i) => i);
  const result = chunk(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].length, D1_IN_CHUNK_SIZE);
  assert.equal(result[1].length, 1);
});

test("chunk rejects non-positive size", () => {
  assert.throws(() => chunk([1], 0));
  assert.throws(() => chunk([1], -1));
});

test("chunkedFindMany short-circuits on empty input without calling runChunk", async () => {
  let called = 0;
  const result = await chunkedFindMany<number, number>([], async () => {
    called++;
    return [];
  });
  assert.deepEqual(result, []);
  assert.equal(called, 0);
});

test("chunkedFindMany invokes runChunk per chunk and concatenates results in order", async () => {
  const calls: number[][] = [];
  const result = await chunkedFindMany<number, string>(
    [1, 2, 3, 4, 5],
    async (idChunk) => {
      calls.push([...idChunk]);
      return idChunk.map((n) => `row-${n}`);
    },
    2,
  );
  assert.deepEqual(calls, [[1, 2], [3, 4], [5]]);
  assert.deepEqual(result, ["row-1", "row-2", "row-3", "row-4", "row-5"]);
});

test("chunkedFindMany runs chunks sequentially", async () => {
  const order: string[] = [];
  await chunkedFindMany<number, number>(
    [1, 2, 3, 4],
    async (idChunk) => {
      order.push(`start-${idChunk[0]}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(`end-${idChunk[0]}`);
      return [];
    },
    2,
  );
  assert.deepEqual(order, ["start-1", "end-1", "start-3", "end-3"]);
});

test("groupBy buckets items by key function", () => {
  const result = groupBy([1, 2, 3, 4, 5], (n) => n % 2);
  assert.deepEqual(result.get(1), [1, 3, 5]);
  assert.deepEqual(result.get(0), [2, 4]);
});

test("groupBy returns empty map for empty input", () => {
  assert.equal(groupBy([], () => 0).size, 0);
});

test("groupBy preserves insertion order within each bucket", () => {
  const items = [
    { k: "a", v: 1 },
    { k: "b", v: 2 },
    { k: "a", v: 3 },
    { k: "a", v: 4 },
  ];
  const result = groupBy(items, (item) => item.k);
  assert.deepEqual(result.get("a")?.map((i) => i.v), [1, 3, 4]);
  assert.deepEqual(result.get("b")?.map((i) => i.v), [2]);
});
