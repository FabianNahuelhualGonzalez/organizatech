import { PROGRESS_PHOTO_MAX_BYTES } from "./progress-records-contract";

export interface PreparedProgressPhoto {
  readonly blob: Blob;
  readonly mimeType: "image/jpeg";
  readonly extension: "jpg";
  readonly width: number;
  readonly height: number;
}

function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return true;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return true;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return false; // Start of compressed image data.
    if (marker === 0xe1 || (marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) return true;
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x00) return true;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return true;
    offset += 2 + length;
  }
  return true;
}

export function isMetadataFreeJpeg(bytes: Uint8Array): boolean {
  return !jpegHasMetadata(bytes);
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.type === "image/jpeg") resolve(blob);
      else reject(new Error("progress_photo_encode_failed"));
    }, "image/jpeg", quality);
  });
}

// This prepares a local candidate. Server authorization must never treat the
// returned MIME, dimensions, size, or metadata check as proof of sanitization.
export async function prepareLocalProgressPhoto(file: File): Promise<PreparedProgressPhoto> {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (image.width < 1 || image.height < 1) throw new Error("progress_photo_decode_failed");
    let scale = Math.min(1, 4096 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("progress_photo_encode_failed");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.94, 0.88, 0.82]) {
        const blob = await encode(canvas, quality);
        if (blob.size > PROGRESS_PHOTO_MAX_BYTES) continue;
        if (!isMetadataFreeJpeg(new Uint8Array(await blob.arrayBuffer()))) {
          throw new Error("progress_photo_metadata_present");
        }
        return { blob, mimeType: "image/jpeg", extension: "jpg", width, height };
      }
      scale *= 0.8;
    }
    throw new Error("progress_photo_encode_failed");
  } finally {
    image.close();
  }
}
