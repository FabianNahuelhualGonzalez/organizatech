import { runMedicalDocumentPublisherPass } from "../src/features/progress-records/server/medical-document-worker";

void runMedicalDocumentPublisherPass().catch(() => {
  // Omit paths, document bytes and credentials from process logs.
  process.exitCode = 1;
});
