import sharp from "sharp";
import { PROGRESS_PHOTO_MAX_BYTES } from "../model/progress-records-contract";

export interface VerifiedProgressPhoto {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/jpeg";
}

function matchesMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return mime === "image/webp" && bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

export function jpegHasPrivateMetadata(bytes: Uint8Array): boolean {
  if (!matchesMagic(bytes, "image/jpeg") || bytes.length < 8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return true;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return true;
    const marker = bytes[offset + 1];
    if (marker === 0xda) {
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length >= bytes.length) return true;
      offset += 2 + length;
      while (offset < bytes.length - 2) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const next = bytes[offset + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        return true;
      }
      return offset !== bytes.length - 2;
    }
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) return true;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00) return true;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return true;
    offset += 2 + length;
  }
  return true;
}

export async function verifyAndSanitizeProgressPhoto(
  source: Uint8Array, expectedMime: string, receivedMime: string,
): Promise<VerifiedProgressPhoto> {
  if (source.byteLength < 1 || source.byteLength > PROGRESS_PHOTO_MAX_BYTES
    || expectedMime !== receivedMime || !matchesMagic(source, expectedMime)) {
    throw new Error("progress_photo_invalid_bytes");
  }
  const decoder = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 });
  const input = await decoder.metadata();
  if ((input.format !== "jpeg" && input.format !== "webp")
    || input.format !== (expectedMime === "image/jpeg" ? "jpeg" : "webp")
    || !input.width || !input.height || input.width > 16_000 || input.height > 16_000) {
    throw new Error("progress_photo_invalid_dimensions");
  }
  const rotated = decoder.rotate().flatten({ background: "#ffffff" });
  for (const side of [4096, 3277, 2622, 2097]) {
    for (const quality of [94, 88, 82]) {
      const bytes = await rotated.clone().resize({ width: side, height: side,
        fit: "inside", withoutEnlargement: true }).jpeg({ quality, progressive: false }).toBuffer();
      if (bytes.byteLength > PROGRESS_PHOTO_MAX_BYTES) continue;
      const output = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
      if (output.format !== "jpeg" || !output.width || !output.height
        || output.exif || output.xmp || output.iptc || output.icc
        || jpegHasPrivateMetadata(bytes)) throw new Error("progress_photo_sanitization_failed");
      return { bytes, width: output.width, height: output.height, mimeType: "image/jpeg" };
    }
  }
  throw new Error("progress_photo_too_large");
}
