import assert from "node:assert/strict";
import test from "node:test";
import { deviceLabelFromUserAgent } from "./user-agent";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

test("deviceLabelFromUserAgent: null/empty -> Unknown", () => {
  assert.equal(deviceLabelFromUserAgent(null), "Unknown");
  assert.equal(deviceLabelFromUserAgent(""), "Unknown");
  assert.equal(deviceLabelFromUserAgent(undefined), "Unknown");
});

test("deviceLabelFromUserAgent: iPhone Safari", () => {
  assert.equal(deviceLabelFromUserAgent(IPHONE_SAFARI), "iPhone · Safari");
});

test("deviceLabelFromUserAgent: Mac Chrome (Chrome wins over the Safari token)", () => {
  assert.equal(deviceLabelFromUserAgent(MAC_CHROME), "Mac · Chrome");
});

test("deviceLabelFromUserAgent: Windows Edge (Edge wins over the Chrome token)", () => {
  assert.equal(deviceLabelFromUserAgent(WINDOWS_EDGE), "Windows · Edge");
});

test("deviceLabelFromUserAgent: Android Chrome", () => {
  assert.equal(deviceLabelFromUserAgent(ANDROID_CHROME), "Android · Chrome");
});

test("deviceLabelFromUserAgent: Windows Firefox", () => {
  assert.equal(deviceLabelFromUserAgent(WINDOWS_FIREFOX), "Windows · Firefox");
});

test("deviceLabelFromUserAgent: unrecognized -> Browser", () => {
  assert.equal(deviceLabelFromUserAgent("some-cli/1.0"), "Browser");
});
