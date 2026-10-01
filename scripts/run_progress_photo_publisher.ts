import { runProgressPhotoPublisherPass } from "../src/features/progress-records/server/progress-photo-worker";

async function main(): Promise<void> {
  const result = await runProgressPhotoPublisherPass();
  console.info(`progress_photo_publisher_status=${result.status}`);
  if (result.status === "failed") process.exitCode = 1;
}

void main().catch(() => {
  // Deliberately omit request details, paths and credentials from process logs.
  console.error("progress_photo_publisher_error");
  process.exitCode = 1;
});
