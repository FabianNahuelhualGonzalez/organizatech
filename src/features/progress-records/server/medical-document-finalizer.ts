import { timingSafeEqual } from "node:crypto";
import { verifyMedicalDocument } from "./verify-medical-document";

export interface ClaimedMedicalDocument {
  readonly uploadId: string;
  readonly stagingBucket: "progress-document-staging";
  readonly stagingPath: string;
  readonly finalBucket: "progress-medical-documents";
  readonly finalPath: string;
}
export interface MedicalDocumentCleanupItem {
  readonly uploadId: string;
  readonly stagingPath: string;
  readonly finalPath: string | null;
}
export interface MedicalDocumentPublicationPort {
  claim(): Promise<ClaimedMedicalDocument | null>;
  download(bucket: string, path: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  upload(bucket: string, path: string, bytes: Uint8Array): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  publish(uploadId: string, bytes: number, pages: number): Promise<string>;
  fail(uploadId: string): Promise<void>;
  claimCleanup(limit: number): Promise<readonly MedicalDocumentCleanupItem[]>;
  completeCleanup(uploadId: string): Promise<void>;
}
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ID = new RegExp(`^${UUID}$`);
const PATH = new RegExp(`^${UUID}/${UUID}\\.pdf$`);

function validClaim(claim: ClaimedMedicalDocument): boolean {
  return ID.test(claim.uploadId) && claim.stagingBucket === "progress-document-staging"
    && claim.finalBucket === "progress-medical-documents"
    && PATH.test(claim.stagingPath) && PATH.test(claim.finalPath);
}
async function cleanup(port: MedicalDocumentPublicationPort, item: MedicalDocumentCleanupItem): Promise<void> {
  if (!ID.test(item.uploadId) || !PATH.test(item.stagingPath)
    || (item.finalPath !== null && !PATH.test(item.finalPath))) {
    throw new Error("medical_document_invalid_cleanup_claim");
  }
  if (item.finalPath) await port.remove("progress-medical-documents", item.finalPath);
  await port.remove("progress-document-staging", item.stagingPath);
  await port.completeCleanup(item.uploadId);
}
export async function cleanExpiredMedicalDocuments(port: MedicalDocumentPublicationPort): Promise<number> {
  const items = await port.claimCleanup(3);
  if (items.length > 3) throw new Error("medical_document_cleanup_unbounded");
  let cleaned = 0;
  for (const item of items) {
    try { await cleanup(port, item); cleaned += 1; }
    catch { /* Lease expiry schedules another bounded attempt. */ }
  }
  return cleaned;
}
export async function finalizeNextMedicalDocument(port: MedicalDocumentPublicationPort):
  Promise<{ status: "idle" | "published" | "failed"; assetId?: string }> {
  const claim = await port.claim();
  if (!claim) return { status: "idle" };
  if (!validClaim(claim)) throw new Error("medical_document_invalid_claim");
  try {
    const staged = await port.download(claim.stagingBucket, claim.stagingPath);
    const verified = verifyMedicalDocument(staged.bytes, staged.mimeType);
    await port.upload(claim.finalBucket, claim.finalPath, verified.bytes);
    const stored = await port.download(claim.finalBucket, claim.finalPath);
    if (stored.mimeType !== "application/pdf"
      || stored.bytes.byteLength !== verified.bytes.byteLength
      || !timingSafeEqual(Buffer.from(stored.bytes), Buffer.from(verified.bytes))) {
      throw new Error("medical_document_final_mismatch");
    }
    await port.remove(claim.stagingBucket, claim.stagingPath);
    const assetId = await port.publish(claim.uploadId, verified.bytes.byteLength, verified.pageCount);
    if (!ID.test(assetId)) throw new Error("medical_document_invalid_asset");
    return { status: "published", assetId };
  } catch {
    try {
      await port.fail(claim.uploadId);
      await cleanup(port, { uploadId: claim.uploadId,
        stagingPath: claim.stagingPath, finalPath: claim.finalPath });
    } catch { /* A cleanup pass retries; publication remains denied. */ }
    return { status: "failed" };
  }
}
