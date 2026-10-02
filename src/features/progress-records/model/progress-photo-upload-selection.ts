import type { StudentPhotoReservation } from "../data/student-progress-photo-gateway";
import type { ProgressPhotoPose } from "./progress-records-contract";
import type { SelectedProgressPhoto } from "./select-progress-photo";

export interface QueuedProgressPhoto {
  readonly reservation: StudentPhotoReservation;
  readonly pose: ProgressPhotoPose;
  readonly file: File;
  readonly format: SelectedProgressPhoto["format"];
  readonly staged: boolean;
  readonly enqueued: boolean;
}

export function matchesSelectedProgressPhoto(
  queued: QueuedProgressPhoto,
  pose: ProgressPhotoPose,
  selected: SelectedProgressPhoto,
): boolean {
  return queued.pose === pose && queued.file === selected.file
    && queued.format === selected.format;
}

export async function abandonQueuedProgressPhoto(
  queued: QueuedProgressPhoto,
  abandon: (uploadId: string) => Promise<void>,
): Promise<void> {
  await abandon(queued.reservation.uploadId);
}

export async function cancelDiscardedProgressCheckUploads(
  uploadIds: readonly string[],
  port: { abandon: (uploadId: string) => Promise<"cleaning" | "cleaned" | "published">;
    cleanupOwn: () => Promise<void> },
): Promise<{ readonly published: boolean; readonly failed: boolean }> {
  if (uploadIds.length === 0) return { published: false, failed: false };
  let published = false;
  let failed = false;
  let needsCleanup = false;
  for (const uploadId of new Set(uploadIds)) {
    try {
      const status = await port.abandon(uploadId);
      if (status === "published") published = true;
      else needsCleanup = true;
    } catch { failed = true; needsCleanup = true; }
  }
  if (needsCleanup) {
    try { await port.cleanupOwn(); } catch { failed = true; }
  }
  return { published, failed };
}
