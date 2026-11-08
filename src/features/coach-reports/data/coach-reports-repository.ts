import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PHOTO_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}[.]jpg$`, "i");
const MEDICAL_DOCUMENT_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}[.]pdf$`, "i");

export type CoachReportKind = "photos" | "medical_document";

export interface CoachReportSummary {
  readonly id: string;
  readonly studentName: string;
  readonly kind: CoachReportKind;
  readonly sentAt: string;
  readonly reviewedAt: string | null;
  readonly itemCount: number;
}

export interface CoachReportItem {
  readonly position: number;
  readonly assetId: string;
  readonly assetKind: "photo" | "medical_document";
  readonly bucketId: "progress-check-photos" | "progress-medical-documents";
  readonly objectName: string;
  readonly mimeType: "image/jpeg" | "application/pdf";
  readonly bytes: number;
  readonly checkedOn: string | null;
  readonly pose: string | null;
  readonly displayName: string | null;
}

export interface CoachReportDetail {
  readonly id: string;
  readonly kind: CoachReportKind;
  readonly message: string | null;
  readonly sentAt: string;
  readonly reviewedAt: string | null;
  readonly items: readonly CoachReportItem[];
}

export class CoachReportsError extends Error {
  constructor(readonly code: "forbidden" | "unavailable") { super(code); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CoachReportsError("unavailable");
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CoachReportsError("unavailable");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new CoachReportsError("unavailable");
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new CoachReportsError("unavailable");
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new CoachReportsError("unavailable");
  }
  return Number(value);
}
function parseKind(value: unknown): CoachReportKind {
  if (value !== "photos" && value !== "medical_document") throw new CoachReportsError("unavailable");
  return value;
}
function parseSummary(value: unknown): CoachReportSummary {
  const row = record(value);
  return {
    id: uuid(row.id), studentName: text(row.studentName, 201), kind: parseKind(row.kind),
    sentAt: timestamp(row.sentAt), reviewedAt: row.reviewedAt === null ? null : timestamp(row.reviewedAt),
    itemCount: integer(row.itemCount, 1, 30),
  };
}
function parseItem(value: unknown): CoachReportItem {
  const row = record(value);
  const validPhoto = row.assetKind === "photo"
    && row.bucketId === "progress-check-photos"
    && row.mimeType === "image/jpeg"
    && typeof row.objectName === "string"
    && PHOTO_PATH.test(row.objectName);
  const validMedicalDocument = row.assetKind === "medical_document"
    && row.bucketId === "progress-medical-documents"
    && row.mimeType === "application/pdf"
    && typeof row.objectName === "string"
    && MEDICAL_DOCUMENT_PATH.test(row.objectName);
  const common = {
    position: integer(row.position, 1, 30), assetId: uuid(row.assetId),
    bytes: integer(row.bytes, 1, 25 * 1024 * 1024),
    checkedOn: row.checkedOn === null ? null : timestamp(`${row.checkedOn}T00:00:00.000Z`).slice(0, 10),
    pose: row.pose === null ? null : text(row.pose, 30),
    displayName: row.displayName === null ? null : text(row.displayName, 160),
  };
  if (validPhoto && typeof row.objectName === "string") return {
    ...common, assetKind: "photo", bucketId: "progress-check-photos",
    objectName: row.objectName, mimeType: "image/jpeg",
  };
  if (validMedicalDocument && typeof row.objectName === "string") return {
    ...common, assetKind: "medical_document", bucketId: "progress-medical-documents",
    objectName: row.objectName, mimeType: "application/pdf",
  };
  throw new CoachReportsError("unavailable");
}
function parseDetail(value: unknown): CoachReportDetail {
  const row = record(value);
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 30) throw new CoachReportsError("unavailable");
  if (row.message !== null && (typeof row.message !== "string" || row.message.length > 2000)) {
    throw new CoachReportsError("unavailable");
  }
  return {
    id: uuid(row.id), kind: parseKind(row.kind), message: row.message,
    sentAt: timestamp(row.sentAt), reviewedAt: row.reviewedAt === null ? null : timestamp(row.reviewedAt),
    items: row.items.map(parseItem),
  };
}
function errorCode(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  throw new CoachReportsError(code === "42501" ? "forbidden" : "unavailable");
}

export function createCoachReportsRepository(client: SupabaseClient) {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await client.rpc(name, args);
    if (result.error) errorCode(result.error);
    return result.data;
  }
  return {
    async list(): Promise<readonly CoachReportSummary[]> {
      const value = await rpc("list_own_coach_progress_reports", { p_limit: 50 });
      if (!Array.isArray(value) || value.length > 50) throw new CoachReportsError("unavailable");
      return value.map(parseSummary);
    },
    async open(reportId: string): Promise<CoachReportDetail> {
      if (!UUID.test(reportId)) throw new CoachReportsError("unavailable");
      return parseDetail(await rpc("review_own_coach_progress_report", { p_report_id: reportId }));
    },
    async download(item: CoachReportItem): Promise<Blob> {
      const result = await client.storage.from(item.bucketId).download(item.objectName);
      if (result.error || !result.data) errorCode(result.error);
      return result.data;
    },
  };
}
