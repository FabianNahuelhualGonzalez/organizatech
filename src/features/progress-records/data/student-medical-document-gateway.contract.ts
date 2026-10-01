import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStudentMedicalDocumentGateway, StudentMedicalDocumentGatewayError,
  MEDICAL_DOCUMENT_MAX_BYTES } from "./student-medical-document-gateway";

const uploadId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000002";
const path = `${uploadId}/${assetId}.pdf`;
const now = new Date(Date.now() + 60_000).toISOString();

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const storage: { bucket?: string; path?: string; options?: unknown } = {};
  const asset = { assetId, bucketId: "progress-medical-documents", objectName: path,
    mimeType: "application/pdf", bytes: 100, pageCount: 1,
    displayName: "Documento médico", documentCategory: "otro",
    createdAt: now, availableAt: now };
  const outputs: Record<string, unknown> = {
    begin_own_medical_document_upload: { uploadId, bucketId: "progress-document-staging",
      objectName: path, mimeType: "application/pdf", expiresAt: now },
    finalize_own_medical_document_upload: uploadId,
    list_own_medical_documents: [asset], get_own_medical_document: asset,
  };
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: outputs[name], error: null };
    },
    storage: { from: (bucket: string) => ({
      upload: async (name: string, _pdf: Blob, options: unknown) => {
        storage.bucket = bucket; storage.path = name; storage.options = options;
        return { error: null };
      },
      download: async (name: string) => {
        storage.bucket = bucket; storage.path = name;
        return { data: new Blob(["%PDF"], { type: "application/pdf" }), error: null };
      },
    }) },
  } as unknown as SupabaseClient;
  return { gateway: createStudentMedicalDocumentGateway(client), calls, storage, outputs };
}

test("gateway stages only SQL-issued path with PDF MIME and no upsert", async () => {
  const { gateway, calls, storage } = fixture();
  const pdf = new Blob(["%PDF-1.7\n"], { type: "application/pdf" });
  await assert.rejects(gateway.stage(uploadId, pdf), StudentMedicalDocumentGatewayError);
  await gateway.reserve();
  await assert.rejects(gateway.stage(uploadId, new Blob(["x"], { type: "text/plain" })),
    StudentMedicalDocumentGatewayError);
  await assert.rejects(gateway.stage(uploadId,
    new Blob([new Uint8Array(MEDICAL_DOCUMENT_MAX_BYTES + 1)], { type: "application/pdf" })),
  StudentMedicalDocumentGatewayError);
  await gateway.stage(uploadId, pdf);
  await gateway.enqueue(uploadId);
  assert.deepEqual(calls, [
    { name: "begin_own_medical_document_upload", args: {} },
    { name: "finalize_own_medical_document_upload", args: { p_upload_id: uploadId } },
  ]);
  assert.deepEqual(storage, { bucket: "progress-document-staging", path,
    options: { contentType: "application/pdf", upsert: false } });
});

test("list, detail and download use bounded RPC arguments and authorized output", async () => {
  const { gateway, calls, storage } = fixture();
  assert.equal((await gateway.list())[0].assetId, assetId);
  assert.equal((await gateway.get(assetId)).pageCount, 1);
  await gateway.downloadOwn(assetId);
  assert.deepEqual(calls.map((call) => call.args), [
    { p_limit: 50, p_offset: 0 }, { p_asset_id: assetId }, { p_asset_id: assetId },
  ]);
  assert.equal(storage.bucket, "progress-medical-documents");
  assert.equal(storage.path, path);
});

test("altered bucket, path, MIME and metadata fail closed", async () => {
  const { gateway, outputs } = fixture();
  await assert.rejects(gateway.list(101), StudentMedicalDocumentGatewayError);
  for (const alteration of [
    { bucketId: "progress-document-staging" }, { objectName: "owner/file.pdf" },
    { mimeType: "text/plain" }, { bytes: MEDICAL_DOCUMENT_MAX_BYTES + 1 },
    { documentCategory: "examen_medico" },
  ]) {
    outputs.get_own_medical_document = { ...(outputs.list_own_medical_documents as object[])[0], ...alteration };
    await assert.rejects(gateway.downloadOwn(assetId), StudentMedicalDocumentGatewayError);
  }
});
