/**
 * Serve marketing demo videos from the private ORG_BRANDING_BUCKET.
 *
 * Keys are only ever `marketing/videos/<name>.mp4`. The name is validated
 * before the key is built, so a request cannot escape that prefix into
 * tenant logos or any other object in the same bucket.
 */

/** One year. The object keys are stable filenames, not content hashes. */
export const MARKETING_VIDEO_CACHE_CONTROL = "public, max-age=31536000";

const MARKETING_VIDEO_PREFIX = "marketing/videos/";
const MARKETING_VIDEO_NAME_RE = /^[a-z0-9-]+\.mp4$/;

export type MarketingVideoObject = {
  body: ReadableStream | null;
  size: number;
  httpEtag: string;
  /**
   * Present when the read was ranged. `size` stays the full object size.
   * `length` may be shorter than requested if the object ends first.
   */
  range?: { offset?: number; length?: number; suffix?: number };
};

export type MarketingVideoBucket = {
  head(key: string): Promise<{ size: number; httpEtag: string } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<MarketingVideoObject | null>;
};

/**
 * Turn a route param into an R2 key, or null when it is not a single
 * lowercase mp4 filename. Rejects traversal, extra path segments, and
 * any extension other than `.mp4`.
 */
export function marketingVideoObjectKey(name: string | undefined): string | null {
  if (!name) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  const normalized = decoded.trim().toLowerCase();
  if (!MARKETING_VIDEO_NAME_RE.test(normalized)) return null;
  return `${MARKETING_VIDEO_PREFIX}${normalized}`;
}

type ParsedRange =
  | { kind: "absent" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; offset: number; length: number };

/**
 * Parse a single HTTP `Range` header against a known object size.
 *
 * - No header, or a range unit other than `bytes`, is "absent" (send 200).
 * - A `bytes` range the object cannot satisfy is "unsatisfiable" (send 416).
 * - Otherwise the first range is clamped to the object and returned as an
 *   inclusive offset + length. Suffix ranges (`bytes=-N`) cover the tail,
 *   and a suffix longer than the object covers the whole object.
 */
export function parseByteRangeHeader(
  header: string | null,
  size: number,
): ParsedRange {
  if (header == null || header.trim() === "") return { kind: "absent" };
  const first = header.split(",")[0]?.trim() ?? "";
  const match = /^bytes=(\d*)-(\d*)$/i.exec(first);
  if (!match) {
    if (/^bytes=/i.test(header.trim())) return { kind: "unsatisfiable" };
    return { kind: "absent" };
  }
  if (!Number.isFinite(size) || size <= 0) return { kind: "unsatisfiable" };

  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";
  if (startStr === "" && endStr === "") return { kind: "unsatisfiable" };

  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    const length = Math.min(suffix, size);
    return { kind: "partial", offset: size - length, length };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return { kind: "unsatisfiable" };
  }
  const end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isInteger(end) || end < start) return { kind: "unsatisfiable" };
  const clampedEnd = Math.min(end, size - 1);
  return { kind: "partial", offset: start, length: clampedEnd - start + 1 };
}

function videoHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "video/mp4");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", MARKETING_VIDEO_CACHE_CONTROL);
  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Read one allowlisted marketing video and answer GET/HEAD, including
 * `206 Partial Content` for `Range` so Safari and iOS can play and seek.
 * Anything that is not a marketing video key is a 404 and does not touch
 * the bucket.
 */
export async function serveMarketingVideo(input: {
  bucket: MarketingVideoBucket;
  objectKey: string;
  method: string;
  rangeHeader: string | null;
}): Promise<Response> {
  if (
    !input.objectKey.startsWith(MARKETING_VIDEO_PREFIX) ||
    input.objectKey.includes("..") ||
    input.objectKey.slice(MARKETING_VIDEO_PREFIX.length).includes("/")
  ) {
    return new Response("Not found", { status: 404 });
  }

  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const head = await input.bucket.head(input.objectKey);
  if (!head) return new Response("Not found", { status: 404 });

  const parsed = parseByteRangeHeader(input.rangeHeader, head.size);
  if (parsed.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: videoHeaders({
        "Content-Range": `bytes */${head.size}`,
      }),
    });
  }

  const object = await input.bucket.get(
    input.objectKey,
    parsed.kind === "partial"
      ? { range: { offset: parsed.offset, length: parsed.length } }
      : undefined,
  );
  if (!object?.body && method !== "HEAD") {
    return new Response("Not found", { status: 404 });
  }

  const headers = videoHeaders({ ETag: object?.httpEtag ?? head.httpEtag });
  if (parsed.kind === "partial") {
    const end = parsed.offset + parsed.length - 1;
    headers.set("Content-Range", `bytes ${parsed.offset}-${end}/${head.size}`);
    headers.set("Content-Length", String(parsed.length));
    return new Response(method === "HEAD" ? null : object?.body ?? null, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(head.size));
  return new Response(method === "HEAD" ? null : object?.body ?? null, {
    status: 200,
    headers,
  });
}
