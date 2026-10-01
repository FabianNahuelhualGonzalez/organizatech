import { cleanExpiredMedicalDocuments, finalizeNextMedicalDocument } from "./medical-document-finalizer";
import { createSupabaseMedicalDocumentPublisher } from "./supabase-medical-document-publisher";
import { assertMedicalDocumentParserAvailable } from "./verify-medical-document";

// Invoke as a single pass in an isolated Node worker outside Vercel.
export async function runMedicalDocumentPublisherPass() {
  assertMedicalDocumentParserAvailable();
  const publisher = await createSupabaseMedicalDocumentPublisher();
  const cleaned = await cleanExpiredMedicalDocuments(publisher);
  const result = await finalizeNextMedicalDocument(publisher);
  return { cleaned, status: result.status };
}
