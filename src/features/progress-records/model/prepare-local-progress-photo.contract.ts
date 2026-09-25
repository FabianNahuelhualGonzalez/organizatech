import assert from "node:assert/strict";
import test from "node:test";
import { isMetadataFreeJpeg } from "./prepare-local-progress-photo";

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
