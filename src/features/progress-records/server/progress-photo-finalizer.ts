import { timingSafeEqual } from "node:crypto";
import { jpegHasPrivateMetadata, verifyAndSanitizeProgressPhoto } from "./verify-progress-photo";

export interface ClaimedProgressPhoto {
  readonly uploadId: string;
  readonly stagingBucket: "progress-check-staging";
  readonly stagingPath: string;
  readonly expectedMime: "image/jpeg" | "image/webp";
  readonly finalBucket: "progress-check-photos";
  readonly finalPath: string;
}

export interface ProgressPhotoCleanupItem {
  readonly uploadId: string;
  readonly stagingPath: string;
  readonly finalPath: string | null;
}

export interface ProgressPhotoPublicationPort {
  claim(): Promise<ClaimedProgressPhoto | null>;
  download(bucket: string, path: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  upload(bucket: string, path: string, bytes: Uint8Array): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  publish(uploadId: string, bytes: number, width: number, height: number): Promise<string>;
  fail(uploadId: string): Promise<void>;
  claimCleanup(limit: number): Promise<readonly ProgressPhotoCleanupItem[]>;
  completeCleanup(uploadId: string): Promise<void>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const STAGING_PATH = new RegExp(`^${UUID}/${UUID}\\.(jpg|webp)$`);
const FINAL_PATH = new RegExp(`^${UUID}/${UUID}\\.jpg$`);
const ID = new RegExp(`^${UUID}$`);

export function validClaim(value: ClaimedProgressPhoto): boolean {
  return ID.test(value.uploadId)
    && value.stagingBucket === "progress-check-staging"
    && STAGING_PATH.test(value.stagingPath)
    && (value.expectedMime === "image/jpeg" || value.expectedMime === "image/webp")
    && value.stagingPath.endsWith(value.expectedMime === "image/jpeg" ? ".jpg" : ".webp")
    && value.finalBucket === "progress-check-photos"
    && FINAL_PATH.test(value.finalPath);
}

async function cleanupClaim(port: ProgressPhotoPublicationPort,
  item: ProgressPhotoCleanupItem): Promise<void> {
  if (!ID.test(item.uploadId) || !STAGING_PATH.test(item.stagingPath)
    || (item.finalPath !== null && !FINAL_PATH.test(item.finalPath))) {
    throw new Error("progress_photo_invalid_cleanup_claim");
  }
  if (item.finalPath) await port.remove("progress-check-photos", item.finalPath);
  await port.remove("progress-check-staging", item.stagingPath);
  await port.completeCleanup(item.uploadId);
}

export async function cleanExpiredProgressPhotos(port: ProgressPhotoPublicationPort): Promise<number> {
  const items = await port.claimCleanup(3);
  if (items.length > 3) throw new Error("progress_photo_cleanup_unbounded");
  let cleaned = 0;
  for (const item of items) {
    try { await cleanupClaim(port, item); cleaned += 1; }
    catch { /* Lease expires for a bounded retry; never publish. */ }
  }
  return cleaned;
}

export async function finalizeNextProgressPhoto(port: ProgressPhotoPublicationPort):
  Promise<{ status: "idle" | "published" | "failed"; assetId?: string }> {
  const claim = await port.claim();
  if (!claim) return { status: "idle" };
  if (!validClaim(claim)) throw new Error("progress_photo_invalid_claim");
  try {
    const staging = await port.download(claim.stagingBucket, claim.stagingPath);
    const verified = await verifyAndSanitizeProgressPhoto(
      staging.bytes, claim.expectedMime, staging.mimeType,
    );
    await port.upload(claim.finalBucket, claim.finalPath, verified.bytes);
    const stored = await port.download(claim.finalBucket, claim.finalPath);
    if (stored.mimeType !== "image/jpeg"
      || stored.bytes.byteLength !== verified.bytes.byteLength
      || !timingSafeEqual(Buffer.from(stored.bytes), Buffer.from(verified.bytes))
      || jpegHasPrivateMetadata(stored.bytes)) {
      throw new Error("progress_photo_final_mismatch");
    }
    await port.remove(claim.stagingBucket, claim.stagingPath);
    const assetId = await port.publish(
      claim.uploadId, verified.bytes.byteLength, verified.width, verified.height,
    );
    if (!ID.test(assetId)) throw new Error("progress_photo_invalid_publish_result");
    return { status: "published", assetId };
  } catch {
    try {
      await port.fail(claim.uploadId);
      await cleanupClaim(port, {
        uploadId: claim.uploadId, stagingPath: claim.stagingPath, finalPath: claim.finalPath,
      });
    } catch { /* A bounded cleanup pass retries after its lease expires. */ }
    return { status: "failed" };
  }
}
