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
