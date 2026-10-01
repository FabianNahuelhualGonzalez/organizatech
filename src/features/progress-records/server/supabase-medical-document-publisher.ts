import { createClient } from "@supabase/supabase-js";
import type { ClaimedMedicalDocument, MedicalDocumentCleanupItem,
  MedicalDocumentPublicationPort } from "./medical-document-finalizer";
import { MAX_MEDICAL_DOCUMENT_BYTES } from "./verify-medical-document";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PATH = new RegExp(`^${UUID}/${UUID}\\.pdf$`);
function address(bucket: string, path: string): void {
  if ((bucket !== "progress-document-staging" && bucket !== "progress-medical-documents")
    || !PATH.test(path)) throw new Error("medical_document_invalid_address");
}

export async function createSupabaseMedicalDocumentPublisher(): Promise<MedicalDocumentPublicationPort> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.PROGRESS_DOCUMENT_TECHNICAL_EMAIL;
  const password = process.env.PROGRESS_DOCUMENT_TECHNICAL_PASSWORD;
  if (!baseUrl || !anonKey || !email || !password) throw new Error("medical_document_worker_unconfigured");
  const authClient = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({ email, password });
  const accessToken = login.session?.access_token;
  if (loginError || !accessToken || !login.user) throw new Error("medical_document_worker_auth_failed");
  const { data: verified, error: claimsError } = await authClient.auth.getClaims(accessToken);
  if (claimsError || verified?.claims.role !== "progress_document_publisher"
    || verified.claims.sub !== login.user.id || typeof verified.claims.exp !== "number"
    || verified.claims.exp - Math.floor(Date.now() / 1000) < 600
    || verified.claims.exp - Number(verified.claims.iat) > 900) {
    throw new Error("medical_document_worker_auth_failed");
  }
  const client = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(name, params);
    if (error) throw new Error("medical_document_worker_rpc_failed");
    return data as T;
  }
  return {
    claim: () => rpc<ClaimedMedicalDocument | null>("claim_medical_document_for_verification"),
    claimCleanup: (limit) => rpc<readonly MedicalDocumentCleanupItem[]>(
      "claim_expired_medical_document_cleanup", { p_limit: limit }),
    completeCleanup: (uploadId) => rpc<void>("complete_medical_document_cleanup", { p_upload_id: uploadId }),
    fail: (uploadId) => rpc<void>("fail_medical_document_verification", { p_upload_id: uploadId }),
    publish: (uploadId, bytes, pages) => rpc<string>("publish_verified_medical_document", {
      p_upload_id: uploadId, p_byte_size: bytes, p_page_count: pages,
    }),
    async download(bucket, path) {
      address(bucket, path);
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const url = new URL(`/storage/v1/object/authenticated/${bucket}/${encoded}`, baseUrl);
      const response = await fetch(url, { headers: {
        Authorization: `Bearer ${accessToken}`, apikey: anonKey,
      }, cache: "no-store" });
      if (!response.ok || !response.body) throw new Error("medical_document_download_failed");
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      const declared = response.headers.get("content-length");
      if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_MEDICAL_DOCUMENT_BYTES) {
        await response.body.cancel();
        throw new Error("medical_document_too_large");
      }
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_MEDICAL_DOCUMENT_BYTES) {
            await reader.cancel();
            throw new Error("medical_document_too_large");
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, mimeType };
    },
    async upload(bucket, path, bytes) {
      if (bucket !== "progress-medical-documents") throw new Error("medical_document_invalid_bucket");
      address(bucket, path);
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType: "application/pdf", cacheControl: "0", upsert: false,
      });
      if (error) throw new Error("medical_document_upload_failed");
    },
    async remove(bucket, path) {
      address(bucket, path);
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error("medical_document_cleanup_failed");
    },
  };
}
