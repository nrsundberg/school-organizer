import test from "node:test";
import assert from "node:assert/strict";
import {
  marketingVideoObjectKey,
  parseByteRangeHeader,
  serveMarketingVideo,
  type MarketingVideoBucket,
} from "./marketing-video.server";

const FILE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

function bucket(objects: Record<string, Uint8Array>): MarketingVideoBucket & {
  gets: Array<{ key: string; range?: { offset: number; length: number } }>;
} {
  const gets: Array<{ key: string; range?: { offset: number; length: number } }> = [];
  return {
    gets,
    async head(key) {
      const bytes = objects[key];
      if (!bytes) return null;
      return { size: bytes.byteLength, httpEtag: `"${key}"` };
    },
    async get(key, options) {
      gets.push({ key, range: options?.range });
      const bytes = objects[key];
      if (!bytes) return null;
      const range = options?.range;
      const slice = range
        ? bytes.subarray(range.offset, range.offset + range.length)
        : bytes;
      return {
        body: new Blob([Uint8Array.from(slice)]).stream(),
        size: bytes.byteLength,
        httpEtag: `"${key}"`,
      };
    },
  };
}

test("marketingVideoObjectKey accepts a single lowercase mp4 name", () => {
  assert.equal(
    marketingVideoObjectKey("getting-started.mp4"),
    "marketing/videos/getting-started.mp4",
  );
  assert.equal(
    marketingVideoObjectKey("Car-Line-Pickups.MP4"),
    "marketing/videos/car-line-pickups.mp4",
  );
});

test("marketingVideoObjectKey rejects traversal and non-mp4 names", () => {
  for (const name of [
    undefined,
    "",
    "../secrets.mp4",
    "..%2Fsecrets.mp4",
    "%2e%2e%2fsecrets.mp4",
    "foo/bar.mp4",
    "foo\\bar.mp4",
    "getting-started.webm",
    ".mp4",
    "getting started.mp4",
    "orgs/abc/logo.mp4",
    "%00.mp4",
  ]) {
    assert.equal(marketingVideoObjectKey(name), null, `expected reject for ${name}`);
  }
});

test("parseByteRangeHeader covers open, closed, and suffix ranges", () => {
  assert.deepEqual(parseByteRangeHeader(null, 10), { kind: "absent" });
  assert.deepEqual(parseByteRangeHeader("bytes=0-3", 10), {
    kind: "partial",
    offset: 0,
    length: 4,
  });
  assert.deepEqual(parseByteRangeHeader("bytes=8-", 10), {
    kind: "partial",
    offset: 8,
    length: 2,
  });
  assert.deepEqual(parseByteRangeHeader("bytes=-4", 10), {
    kind: "partial",
    offset: 6,
    length: 4,
  });
  assert.deepEqual(parseByteRangeHeader("bytes=-999", 10), {
    kind: "partial",
    offset: 0,
    length: 10,
  });
  assert.deepEqual(parseByteRangeHeader("bytes=0-999", 10), {
    kind: "partial",
    offset: 0,
    length: 10,
  });
  // Multiple ranges: only the first is honored.
  assert.deepEqual(parseByteRangeHeader("bytes=0-1, 5-6", 10), {
    kind: "partial",
    offset: 0,
    length: 2,
  });
});

test("parseByteRangeHeader rejects unsatisfiable byte ranges", () => {
  assert.equal(parseByteRangeHeader("bytes=10-", 10).kind, "unsatisfiable");
  assert.equal(parseByteRangeHeader("bytes=5-4", 10).kind, "unsatisfiable");
  assert.equal(parseByteRangeHeader("bytes=-0", 10).kind, "unsatisfiable");
  assert.equal(parseByteRangeHeader("bytes=0-1", 0).kind, "unsatisfiable");
  // A non-bytes unit is ignored so the full object can be returned.
  assert.equal(parseByteRangeHeader("items=0-1", 10).kind, "absent");
});

test("serveMarketingVideo returns the full object with video headers", async () => {
  const store = bucket({ "marketing/videos/getting-started.mp4": FILE });
  const res = await serveMarketingVideo({
    bucket: store,
    objectKey: "marketing/videos/getting-started.mp4",
    method: "GET",
    rangeHeader: null,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "video/mp4");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000");
  assert.equal(res.headers.get("Content-Length"), "10");
  assert.equal(res.headers.get("ETag"), '"marketing/videos/getting-started.mp4"');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), FILE);
  assert.equal(store.gets.length, 1);
  assert.equal(store.gets[0]?.range, undefined);
});

test("serveMarketingVideo answers Range with 206 Partial Content", async () => {
  const store = bucket({ "marketing/videos/car-line-pickups.mp4": FILE });
  const res = await serveMarketingVideo({
    bucket: store,
    objectKey: "marketing/videos/car-line-pickups.mp4",
    method: "GET",
    rangeHeader: "bytes=0-1",
  });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), "bytes 0-1/10");
  assert.equal(res.headers.get("Content-Length"), "2");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal(res.headers.get("Content-Type"), "video/mp4");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0, 1]));
  assert.deepEqual(store.gets[0]?.range, { offset: 0, length: 2 });
});

test("serveMarketingVideo returns 416 when the range is past the end", async () => {
  const store = bucket({ "marketing/videos/fire-drills-safety.mp4": FILE });
  const res = await serveMarketingVideo({
    bucket: store,
    objectKey: "marketing/videos/fire-drills-safety.mp4",
    method: "GET",
    rangeHeader: "bytes=100-200",
  });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("Content-Range"), "bytes */10");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal(store.gets.length, 0);
});

test("serveMarketingVideo 404s unknown keys and never reads outside the prefix", async () => {
  const store = bucket({
    "marketing/videos/getting-started.mp4": FILE,
    "orgs/secret/logo.png": FILE,
  });
  const missing = await serveMarketingVideo({
    bucket: store,
    objectKey: "marketing/videos/missing.mp4",
    method: "GET",
    rangeHeader: null,
  });
  assert.equal(missing.status, 404);

  const escaped = await serveMarketingVideo({
    bucket: store,
    objectKey: "orgs/secret/logo.png",
    method: "GET",
    rangeHeader: null,
  });
  assert.equal(escaped.status, 404);
  assert.equal(store.gets.length, 0);
});

test("HEAD returns headers and no body", async () => {
  const store = bucket({ "marketing/videos/getting-started.mp4": FILE });
  const res = await serveMarketingVideo({
    bucket: store,
    objectKey: "marketing/videos/getting-started.mp4",
    method: "HEAD",
    rangeHeader: "bytes=2-5",
  });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(res.headers.get("Content-Length"), "4");
  assert.equal(await res.text(), "");
});
