import { timingSafeEqual } from "node:crypto";

import { type AutomaticProgressPhotoPublicationPort,
  createSupabaseProgressPhotoPublisher } from "./supabase-progress-photo-publisher";
import { validClaim } from "./progress-photo-finalizer";
import { jpegHasPrivateMetadata, verifyAndSanitizeProgressPhoto } from "./verify-progress-photo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAGING_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const FINAL_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

type PublicationStatus = "published" | "queued" | "retry";

// Each claim owns a unique final path. No attempt deletes a candidate before publishing.
export async function publishOneOwnProgressPhoto(
  studentId: string,
  uploadId: string,
  port: AutomaticProgressPhotoPublicationPort,
): Promise<PublicationStatus> {
  const claim = await port.claimForStudent(studentId, uploadId);
  if (!claim) return "queued";
  if (!validClaim(claim) || claim.uploadId !== uploadId
    || !UUID.test(claim.attemptId)
    || !claim.finalPath.startsWith(`${claim.attemptId}/`)) {
    throw new Error("progress_photo_invalid_claim");
  }

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
    // SQL checks the active attempt and the still-private original atomically.
    const assetId = await port.publishAutomatic(claim.uploadId, claim.attemptId,
      verified.bytes.byteLength, verified.width, verified.height);
    if (`${assetId}.jpg` !== claim.finalPath.split("/")[1]) {
      throw new Error("progress_photo_invalid_publish_result");
    }
  } catch {
    try { await port.releaseForRetry(claim.uploadId, claim.attemptId); }
    catch { /* A stale processing attempt is recoverable after its lease. */ }
    return "retry";
  }

  // SQL has already recorded cleanup debt. Failure never removes the published asset.
  try {
    await port.remove(claim.stagingBucket, claim.stagingPath);
    await port.completePublishedStaging(claim.uploadId);
  } catch { /* A bounded cleanup pass can reclaim this private original. */ }
  return "published";
}

function validPath(path: string, pattern: RegExp): boolean {
  if (!pattern.test(path)) return false;
  const [directory, filename] = path.split("/");
  return UUID.test(directory) && UUID.test(filename.split(".")[0]);
}

async function retryRemove(port: AutomaticProgressPhotoPublicationPort,
  bucket: "progress-check-staging" | "progress-check-photos", path: string): Promise<void> {
  try { await port.remove(bucket, path); }
  catch { await port.remove(bucket, path); }
}

// At most three claimed cleanup items total. Each may make at most two Storage attempts.
export async function cleanOwnProgressPhotoResidue(
  studentId: string,
  port: AutomaticProgressPhotoPublicationPort,
  limit = 3,
): Promise<number> {
  if (!UUID.test(studentId) || !Number.isInteger(limit) || limit < 1 || limit > 3) {
    throw new Error("progress_photo_cleanup_invalid_limit");
  }
  let handled = 0;
  const deleted = await port.claimDeletedFinal(studentId, limit);
  if (!Array.isArray(deleted) || deleted.length > limit) throw new Error("progress_photo_cleanup_unbounded");
  for (const item of deleted) {
    if (!UUID.test(item.assetId) || !validPath(item.finalPath, FINAL_PATH)) {
      throw new Error("progress_photo_invalid_cleanup_claim");
    }
    handled += 1;
    try {
      await retryRemove(port, "progress-check-photos", item.finalPath);
      await port.completeDeletedFinal(item.assetId);
    } catch {
      // Storage may have removed the object before its response failed.
      try { await port.completeDeletedFinal(item.assetId); }
      catch { /* Exact SQL cleanup debt remains for a later bounded pass. */ }
    }
  }
  if (handled === limit) return handled;
  const published = await port.claimPublishedStaging(studentId, limit - handled);
  if (!Array.isArray(published) || published.length > limit - handled) {
    throw new Error("progress_photo_cleanup_unbounded");
  }
  for (const item of published) {
    if (!UUID.test(item.uploadId) || !validPath(item.stagingPath, STAGING_PATH)) {
      throw new Error("progress_photo_invalid_cleanup_claim");
    }
    handled += 1;
    try {
      await retryRemove(port, "progress-check-staging", item.stagingPath);
      await port.completePublishedStaging(item.uploadId);
    } catch {
      try { await port.completePublishedStaging(item.uploadId); }
      catch { /* Cleanup debt and lease remain in SQL. */ }
    }
  }
  if (handled === limit) return handled;

  const cancelled = await port.claimOwnCleanup(studentId, limit - handled);
  if (!Array.isArray(cancelled) || cancelled.length > limit - handled) {
    throw new Error("progress_photo_cleanup_unbounded");
  }
  for (const item of cancelled) {
    if (!UUID.test(item.uploadId) || !validPath(item.stagingPath, STAGING_PATH)
      || (item.finalPath !== null && !validPath(item.finalPath, FINAL_PATH))) {
      throw new Error("progress_photo_invalid_cleanup_claim");
    }
    handled += 1;
    try {
      if (item.finalPath) await retryRemove(port, "progress-check-photos", item.finalPath);
      await retryRemove(port, "progress-check-staging", item.stagingPath);
      await port.completeCleanup(item.uploadId);
    } catch {
      try { await port.completeCleanup(item.uploadId); }
      catch { /* Cleanup debt and lease remain in SQL. */ }
    }
  }
  if (handled === limit) return handled;

  const abandoned = await port.claimAbandoned(studentId, limit - handled);
  if (!Array.isArray(abandoned) || abandoned.length > limit - handled) {
    throw new Error("progress_photo_cleanup_unbounded");
  }
  for (const item of abandoned) {
    if (!UUID.test(item.attemptId) || !validPath(item.finalPath, FINAL_PATH)
      || !item.finalPath.startsWith(`${item.attemptId}/`)) {
      throw new Error("progress_photo_invalid_cleanup_claim");
    }
    handled += 1;
    try {
      await retryRemove(port, "progress-check-photos", item.finalPath);
      await port.completeAbandoned(item.attemptId);
    } catch {
      try { await port.completeAbandoned(item.attemptId); }
      catch { /* Exact abandoned candidate remains tracked for a later pass. */ }
    }
  }
  return handled;
}

export async function publishOwnProgressPhotoBatchWithPort(
  studentId: string,
  uploadIds: readonly string[],
  port: AutomaticProgressPhotoPublicationPort,
): Promise<"idle" | PublicationStatus> {
  if (!UUID.test(studentId) || uploadIds.length > 3
    || uploadIds.some((id) => !UUID.test(id))
    || new Set(uploadIds).size !== uploadIds.length) {
    throw new Error("progress_photo_invalid_batch");
  }
  let result: "idle" | PublicationStatus = "idle";
  for (const uploadId of uploadIds) {
    const status = await publishOneOwnProgressPhoto(studentId, uploadId, port);
    if (status === "retry") result = "retry";
    else if (result !== "retry" && status === "queued") result = "queued";
    else if (result === "idle") result = "published";
  }
  await cleanOwnProgressPhotoResidue(studentId, port);
  return result;
}

export async function runOwnProgressPhotoPublisherBatch(
  studentId: string,
  uploadIds: readonly string[],
): Promise<"idle" | PublicationStatus> {
  return publishOwnProgressPhotoBatchWithPort(studentId, uploadIds,
    await createSupabaseProgressPhotoPublisher());
}

export async function runOwnProgressPhotoCleanupPass(studentId: string): Promise<number> {
  const port = await createSupabaseProgressPhotoPublisher();
  return cleanOwnProgressPhotoResidue(studentId, port);
}
