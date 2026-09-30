import { runProgressPhotoPublisherPass } from "../src/features/progress-records/server/progress-photo-worker";

async function main(): Promise<void> {
  await runProgressPhotoPublisherPass();
}

void main().catch(() => {
  // Deliberately omit request details, paths and credentials from process logs.
  process.exitCode = 1;
});
