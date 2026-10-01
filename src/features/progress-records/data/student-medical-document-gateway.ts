import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export const MEDICAL_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;

export interface MedicalDocumentReservation {
  readonly uploadId: string;
  readonly bucketId: "progress-document-staging";
  readonly objectName: string;
  readonly mimeType: "application/pdf";
  readonly expiresAt: string;
}

export interface MedicalDocumentAsset {
  readonly assetId: string;
  readonly bucketId: "progress-medical-documents";
  readonly objectName: string;
  readonly mimeType: "application/pdf";
  readonly bytes: number;
  readonly pageCount: number;
  readonly displayName: string;
  readonly documentCategory: "otro";
  readonly createdAt: string;
  readonly availableAt: string;
}

export class StudentMedicalDocumentGatewayError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "unavailable") {
    super(code);
  }
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return value;
}
function path(value: unknown): string {
  if (typeof value !== "string" || !PATH.test(value)) {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return value;
}
function parseReservation(value: unknown): MedicalDocumentReservation {
  const data = row(value);
  if (data.bucketId !== "progress-document-staging" || data.mimeType !== "application/pdf") {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return { uploadId: uuid(data.uploadId), bucketId: data.bucketId,
    objectName: path(data.objectName), mimeType: data.mimeType,
    expiresAt: timestamp(data.expiresAt) };
}
function parseAsset(value: unknown): MedicalDocumentAsset {
  const data = row(value);
  if (data.bucketId !== "progress-medical-documents" || data.mimeType !== "application/pdf"
    || !Number.isSafeInteger(data.bytes) || Number(data.bytes) < 1
    || Number(data.bytes) > MEDICAL_DOCUMENT_MAX_BYTES
    || !Number.isSafeInteger(data.pageCount) || Number(data.pageCount) < 1
    || Number(data.pageCount) > 10000
    || data.displayName !== "Documento médico" || data.documentCategory !== "otro") {
    throw new StudentMedicalDocumentGatewayError("unavailable");
  }
  return { assetId: uuid(data.assetId), bucketId: data.bucketId,
    objectName: path(data.objectName), mimeType: data.mimeType,
    bytes: Number(data.bytes), pageCount: Number(data.pageCount),
    displayName: data.displayName, documentCategory: data.documentCategory,
    createdAt: timestamp(data.createdAt), availableAt: timestamp(data.availableAt) };
}
function rpcError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  throw new StudentMedicalDocumentGatewayError(code === "42501" ? "forbidden" : "unavailable");
}

export function createStudentMedicalDocumentGateway(client: SupabaseClient) {
  const reservations = new Map<string, MedicalDocumentReservation>();
  async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await client.rpc(name, args);
    if (result.error) rpcError(result.error);
    return result.data;
  }
  return {
    async reserve(): Promise<MedicalDocumentReservation> {
      const reservation = parseReservation(await rpc("begin_own_medical_document_upload"));
      reservations.set(reservation.uploadId, reservation);
      return reservation;
    },
    async stage(uploadId: string, pdf: Blob): Promise<void> {
      const reservation = reservations.get(uploadId);
      if (!reservation || pdf.type !== "application/pdf" || pdf.size < 1
        || pdf.size > MEDICAL_DOCUMENT_MAX_BYTES || Date.now() >= Date.parse(reservation.expiresAt)) {
        throw new StudentMedicalDocumentGatewayError("invalid_input");
      }
      const { error } = await client.storage.from(reservation.bucketId).upload(reservation.objectName, pdf, {
        contentType: "application/pdf", upsert: false,
      });
      if (error) rpcError(error);
    },
    async enqueue(uploadId: string): Promise<void> {
      if (!UUID.test(uploadId)) throw new StudentMedicalDocumentGatewayError("invalid_input");
      uuid(await rpc("finalize_own_medical_document_upload", { p_upload_id: uploadId }));
      reservations.delete(uploadId);
    },
    async list(limit = 50, offset = 0): Promise<readonly MedicalDocumentAsset[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
        throw new StudentMedicalDocumentGatewayError("invalid_input");
      }
      const data = await rpc("list_own_medical_documents", { p_limit: limit, p_offset: offset });
      if (!Array.isArray(data) || data.length > 100) throw new StudentMedicalDocumentGatewayError("unavailable");
      return data.map(parseAsset);
    },
    async get(assetId: string): Promise<MedicalDocumentAsset> {
      if (!UUID.test(assetId)) throw new StudentMedicalDocumentGatewayError("invalid_input");
      return parseAsset(await rpc("get_own_medical_document", { p_asset_id: assetId }));
    },
    async downloadOwn(assetId: string): Promise<Blob> {
      const asset = await this.get(assetId);
      const { data, error } = await client.storage.from(asset.bucketId).download(asset.objectName);
      if (error || !data) rpcError(error);
      return data;
    },
  };
}

export function getStudentMedicalDocumentGateway() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new StudentMedicalDocumentGatewayError("unavailable");
  return createStudentMedicalDocumentGateway(client);
}
