import { runMedicalDocumentPublisherPass } from "../src/features/progress-records/server/medical-document-worker";

async function main(): Promise<void> {
  const result = await runMedicalDocumentPublisherPass();
  console.info(`medical_document_publisher_status=${result.status}`);
  if (result.status === "failed") process.exitCode = 1;
}

void main().catch(() => {
  // Omit paths, document bytes and credentials from process logs.
  console.error("medical_document_publisher_error");
  process.exitCode = 1;
});
