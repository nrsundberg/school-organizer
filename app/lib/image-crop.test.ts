import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOutputType, mimeToExt } from "./image-crop.js";

describe("resolveOutputType", () => {
  it("preserves image/png", () => {
    assert.equal(resolveOutputType("image/png"), "image/png");
  });

  it("preserves image/jpeg", () => {
    assert.equal(resolveOutputType("image/jpeg"), "image/jpeg");
  });

  it("preserves image/webp", () => {
    assert.equal(resolveOutputType("image/webp"), "image/webp");
  });

  it("falls back to webp for unknown type", () => {
    assert.equal(resolveOutputType("image/gif"), "image/webp");
    assert.equal(resolveOutputType("application/octet-stream"), "image/webp");
    assert.equal(resolveOutputType(""), "image/webp");
  });
});

describe("mimeToExt", () => {
  it("maps png", () => {
    assert.equal(mimeToExt("image/png"), "png");
  });

  it("maps webp", () => {
    assert.equal(mimeToExt("image/webp"), "webp");
  });

  it("maps jpeg to jpg", () => {
    assert.equal(mimeToExt("image/jpeg"), "jpg");
  });
});
