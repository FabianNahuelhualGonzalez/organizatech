import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PROGRESS_PHOTO_MAX_BYTES, type ProgressPhotoMime } from "../model/progress-records-contract";

export type PhotoInput = { bytes: Uint8Array; mime: ProgressPhotoMime; extension: string };
export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string; attestationKey: string };
export type UploadedPhoto = {
  assetId: string; cloudinaryAssetId: string; mime: ProgressPhotoMime;
  extension: string; bytes: number; width: number; height: number;
};

const FORMAT_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" } as const;
const MIME_EXTENSIONS: Record<ProgressPhotoMime, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
  "image/webp": ["webp"], "image/heic": ["heic"],
};

export function photoInput(bytes: Uint8Array, mime: string, filename: string): PhotoInput {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (bytes.byteLength < 16 || bytes.byteLength > PROGRESS_PHOTO_MAX_BYTES ||
    !(mime in MIME_EXTENSIONS) || !MIME_EXTENSIONS[mime as ProgressPhotoMime].includes(extension)) {
    throw new Error("invalid_photo");
  }
  const head = Buffer.from(bytes.subarray(0, 16));
  const detected = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? "image/jpeg"
    : head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP" ? "image/webp"
    : head.toString("ascii", 4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx"].includes(head.toString("ascii", 8, 12)) ? "image/heic"
    : null;
  if (detected !== mime) throw new Error("invalid_photo");
  return { bytes, mime: mime as ProgressPhotoMime, extension };
}

export function cloudinaryConfig(env: NodeJS.ProcessEnv): CloudinaryConfig {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: apiSecret, PROGRESS_PHOTO_ATTESTATION_KEY: attestationKey } = env;
  if (!cloudName || !/^[a-z0-9_-]+$/i.test(cloudName) || !apiKey || !apiSecret || !attestationKey) {
    throw new Error("photo_backend_unconfigured");
  }
  return { cloudName, apiKey, apiSecret, attestationKey };
}

function sign(params: Record<string, string>, secret: string): string {
  const message = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("&") + secret;
  return createHash("sha1").update(message).digest("hex");
}

function exactSignature(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && /^[a-f0-9]{40}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function uploadPhoto(input: PhotoInput, config: CloudinaryConfig,
  fetcher: typeof fetch = fetch): Promise<UploadedPhoto> {
  const assetId = randomUUID();
  const params = {
    allowed_formats: "jpg,png,webp,heic",
    discard_original_filename: "true",
    overwrite: "false",
    public_id: assetId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    transformation: "fl_force_strip",
    type: "authenticated",
    unique_filename: "false",
    use_filename: "false",
  };
  const body = new FormData();
  for (const [key, value] of Object.entries(params)) body.set(key, value);
  body.set("api_key", config.apiKey);
  body.set("signature", sign(params, config.apiSecret));
  body.set("file", new Blob([Buffer.from(input.bytes)], { type: input.mime }), `${assetId}.${input.extension}`);
  const response = await fetcher(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    { method: "POST", body, cache: "no-store" });
  if (!response.ok) throw new Error("photo_provider_failed");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new Error("photo_provider_invalid");
  const data = result as Record<string, unknown>;
  const format = data.format;
  const expectedMime = typeof format === "string" ? FORMAT_MIME[format as keyof typeof FORMAT_MIME] : undefined;
  if (data.public_id !== assetId || data.resource_type !== "image" || data.type !== "authenticated" ||
    !expectedMime || expectedMime !== input.mime || !MIME_EXTENSIONS[input.mime].includes(input.extension) ||
    typeof data.asset_id !== "string" || !/^[a-zA-Z0-9_-]{16,64}$/.test(data.asset_id) ||
    !Number.isSafeInteger(data.version) || !Number.isSafeInteger(data.bytes) ||
    !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) ||
    (data.bytes as number) < 1 || (data.bytes as number) > PROGRESS_PHOTO_MAX_BYTES ||
    (data.width as number) < 1 || (data.height as number) < 1 ||
    !exactSignature(data.signature, sign({ public_id: assetId, version: String(data.version) }, config.apiSecret))) {
    throw new Error("photo_provider_invalid");
  }
  return { assetId, cloudinaryAssetId: data.asset_id, mime: input.mime,
    extension: input.extension, bytes: data.bytes as number,
    width: data.width as number, height: data.height as number };
}

export function attestPhoto(studentId: string, photo: UploadedPhoto, issuedAt: number, key: string): string {
  const payload = [studentId, photo.assetId, photo.cloudinaryAssetId, photo.mime,
    photo.extension, photo.bytes, photo.width, photo.height, issuedAt].join("|");
  return createHmac("sha256", key).update(payload).digest("hex");
}

export async function downloadPhoto(cloudinaryAssetId: string, config: CloudinaryConfig,
  fetcher: typeof fetch = fetch): Promise<Response> {
  const params = { asset_id: cloudinaryAssetId, expires_at: String(Math.floor(Date.now() / 1000) + 30),
    timestamp: String(Math.floor(Date.now() / 1000)) };
  const body = new URLSearchParams({ ...params, api_key: config.apiKey, signature: sign(params, config.apiSecret) });
  return fetcher(`https://api.cloudinary.com/v1_1/${config.cloudName}/asset/download`,
    { method: "POST", body, cache: "no-store" });
}

export async function discardUnregisteredPhoto(publicId: string, config: CloudinaryConfig,
  fetcher: typeof fetch = fetch): Promise<void> {
  const params = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)),
    type: "authenticated" };
  const body = new URLSearchParams({ ...params, api_key: config.apiKey,
    signature: sign(params, config.apiSecret) });
  const response = await fetcher(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
    { method: "POST", body, cache: "no-store" });
  if (!response.ok) throw new Error("photo_cleanup_failed");
}
