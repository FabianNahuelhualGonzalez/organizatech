import { runProgressPhotoPublisherPass } from "../src/features/progress-records/server/progress-photo-worker";

try {
  await runProgressPhotoPublisherPass();
} catch {
  // Deliberately omit request details, paths and credentials from process logs.
  process.exitCode = 1;
}
