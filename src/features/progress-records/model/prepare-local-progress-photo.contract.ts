import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { isMetadataFreeJpeg, prepareLocalProgressPhoto } from "./prepare-local-progress-photo";

const image = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0,
  0xff, 0xda, 0, 2, 0, 0xff, 0xd9];

test("JPEG reencoded candidate rejects EXIF, XMP and comments", () => {
  assert.equal(isMetadataFreeJpeg(new Uint8Array(image)), true);
  for (const marker of [0xe1, 0xed, 0xfe]) {
    assert.equal(isMetadataFreeJpeg(new Uint8Array([
      0xff, 0xd8, 0xff, marker, 0, 4, 0, 0, ...image.slice(2),
    ])), false);
  }
  assert.equal(isMetadataFreeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1])), false);
  assert.equal(isMetadataFreeJpeg(new Uint8Array([0, ...image.slice(1)])), false);
});

function replace(t: TestContext, target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

function mockBrowser(t: TestContext, outcome: "load" | "error" | "abort", bitmap: "absent" | "reject" | "success" = "absent", encode = true) {
  const revoked: string[] = [];
  const drawn: unknown[] = [];
  const images: FakeImage[] = [];
  let bitmapClosed = 0;
  let canvasCreated = 0;
  let bitmapCalls = 0;

  class FakeImage {
    naturalWidth = 5000;
    naturalHeight = 2500;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    currentSrc = "";
    constructor() { images.push(this); }
    set src(value: string) {
      this.currentSrc = value;
      if (value) queueMicrotask(() => this[`on${outcome}`]?.());
    }
  }

  replace(t, globalThis, "Image", FakeImage);
  replace(t, URL, "createObjectURL", () => "blob:progress-test");
  replace(t, URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  replace(t, globalThis, "document", {
    createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      canvasCreated += 1;
      return {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: (source: unknown) => { drawn.push(source); } }),
        toBlob: (callback: BlobCallback) => callback(encode ? new Blob([new Uint8Array(image)], { type: "image/jpeg" }) : null),
      };
    },
  });
  if (bitmap === "absent") replace(t, globalThis, "createImageBitmap", undefined);
  else replace(t, globalThis, "createImageBitmap", async (_file: File, options: ImageBitmapOptions) => {
    bitmapCalls += 1;
    assert.equal(options.imageOrientation, "from-image");
    if (bitmap === "reject") throw new Error("native decoder details must stay private");
    return { width: 800, height: 600, close: () => { bitmapClosed += 1; } };
  });
  return { revoked, drawn, images, get bitmapClosed() { return bitmapClosed; }, get canvasCreated() { return canvasCreated; }, get bitmapCalls() { return bitmapCalls; } };
}

const file = {} as File;

test("Safari fallback prepares a bounded metadata-free JPEG and releases its object URL", async (t) => {
  const browser = mockBrowser(t, "load");
  const prepared = await prepareLocalProgressPhoto(file);
  assert.deepEqual([prepared.mimeType, prepared.extension, prepared.width, prepared.height], ["image/jpeg", "jpg", 4096, 2048]);
  assert.equal(isMetadataFreeJpeg(new Uint8Array(await prepared.blob.arrayBuffer())), true);
  assert.equal(browser.drawn[0], browser.images[0]);
  assert.deepEqual(browser.revoked, ["blob:progress-test"]);
  assert.equal(browser.images[0].currentSrc, "");
});

test("failed createImageBitmap decoding falls back to Image", async (t) => {
  const browser = mockBrowser(t, "load", "reject");
  await prepareLocalProgressPhoto(file);
  assert.equal(browser.bitmapCalls, 1);
  assert.equal(browser.images.length, 1);
  assert.deepEqual(browser.revoked, ["blob:progress-test"]);
});

test("successful createImageBitmap remains first choice and closes its bitmap", async (t) => {
  const browser = mockBrowser(t, "load", "success");
  await prepareLocalProgressPhoto(file);
  assert.equal(browser.bitmapCalls, 1);
  assert.equal(browser.bitmapClosed, 1);
  assert.equal(browser.images.length, 0);
  assert.equal(browser.revoked.length, 0);
});

test("fallback releases its object URL when JPEG encoding fails", async (t) => {
  const browser = mockBrowser(t, "load", "absent", false);
  await assert.rejects(prepareLocalProgressPhoto(file), { message: "progress_photo_encode_failed" });
  assert.deepEqual(browser.revoked, ["blob:progress-test"]);
  assert.equal(browser.images[0].currentSrc, "");
});

for (const outcome of ["error", "abort"] as const) {
  test(`fallback ${outcome} releases its object URL without exposing decoder details`, async (t) => {
    const browser = mockBrowser(t, outcome, "reject");
    await assert.rejects(prepareLocalProgressPhoto(file), { message: "progress_photo_decode_failed" });
    assert.deepEqual(browser.revoked, ["blob:progress-test"]);
    assert.equal(browser.images[0].currentSrc, "");
    assert.equal(browser.canvasCreated, 0);
  });
}
