import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { jpegHasPrivateMetadata, verifyAndSanitizeProgressPhoto } from "./verify-progress-photo";

test("real JPEG bytes with EXIF are reencoded without private metadata", async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3,
    background: "#446688" } }).jpeg().withExif({ IFD0: { Copyright: "fixture" } }).toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const output = await verifyAndSanitizeProgressPhoto(source, "image/jpeg", "image/jpeg");
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(output.mimeType, "image/jpeg");
  assert.equal(output.width, 40);
  assert.equal(output.height, 20);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.equal(jpegHasPrivateMetadata(output.bytes), false);
});

test("rejects mismatched MIME, magic bytes, corrupt pixels and oversized real input", async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3,
    background: "#446688" } }).jpeg().toBuffer();
  await assert.rejects(verifyAndSanitizeProgressPhoto(jpeg, "image/webp", "image/webp"));
  await assert.rejects(verifyAndSanitizeProgressPhoto(jpeg, "image/jpeg", "image/webp"));
  await assert.rejects(verifyAndSanitizeProgressPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    "image/jpeg", "image/jpeg"));
  await assert.rejects(verifyAndSanitizeProgressPhoto(new Uint8Array(20 * 1024 * 1024 + 1),
    "image/jpeg", "image/jpeg"));
});

test("WebP staging is decoded and published as metadata-free JPEG", async () => {
  const webp = await sharp({ create: { width: 24, height: 12, channels: 3,
    background: "#446688" } }).webp().toBuffer();
  const output = await verifyAndSanitizeProgressPhoto(webp, "image/webp", "image/webp");
  assert.equal(output.width, 24);
  assert.equal(output.height, 12);
  assert.equal((await sharp(output.bytes).metadata()).format, "jpeg");
  assert.equal(jpegHasPrivateMetadata(output.bytes), false);
});
