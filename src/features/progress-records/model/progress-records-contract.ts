export const PROGRESS_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PROGRESS_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PROGRESS_REPORT_MAX_ITEMS = 30;
export const PROGRESS_REPORT_MAX_MESSAGE_LENGTH = 2000;

export type ProgressSurface = "evaluations" | "forms" | "documents" | "photos";
export type ProgressPortal = "usuario";
export type ProgressPhotoPose = "frente" | "perfil" | "espalda";
export type ProgressPhotoMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic";
export type ProgressPhotoExtension = "jpg" | "jpeg" | "png" | "webp" | "heic";
export type ProgressDocumentMime = "application/pdf";
export type ProgressDocumentExtension = "pdf";
export type ProgressDocumentCategory =
  | "examen_medico"
  | "informe_medico"
  | "receta"
  | "nutricion"
  | "otro";
export type ProgressAssetKind = "photo" | "medical_document";
export type ProgressReportKind = "photos" | "medical_document";

export interface StudentProgressAccess {
  readonly portal: ProgressPortal;
  readonly relationshipEpisodeId: string;
  readonly coachUserId: string;
  readonly coachName: string;
  readonly coachEmail: string;
  readonly surfaces: readonly ProgressSurface[];
}

export type ProgressUploadDraft =
  | {
      readonly kind: "photo";
      readonly mimeType: ProgressPhotoMime;
      readonly extension: ProgressPhotoExtension;
      readonly bytes: number;
    }
  | {
      readonly kind: "medical_document";
      readonly mimeType: ProgressDocumentMime;
      readonly extension: ProgressDocumentExtension;
      readonly bytes: number;
      readonly displayName: string;
      readonly category: ProgressDocumentCategory;
    };

interface ProgressAssetBase {
  readonly id: string;
  readonly objectName: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly availableAt: string;
}

export type ProgressAsset =
  | (ProgressAssetBase & {
      readonly kind: "photo";
      readonly bucketId: "progress-check-photos";
      readonly mimeType: ProgressPhotoMime;
      readonly extension: ProgressPhotoExtension;
      readonly width: number;
      readonly height: number;
      readonly sanitizedAt: string;
    })
  | (ProgressAssetBase & {
      readonly kind: "medical_document";
      readonly bucketId: "progress-medical-documents";
      readonly mimeType: ProgressDocumentMime;
      readonly extension: ProgressDocumentExtension;
      readonly displayName: string;
      readonly category: ProgressDocumentCategory;
      readonly pageCount: number | null;
    });

export interface ProgressCheckPhoto {
  readonly assetId: string;
  readonly pose: ProgressPhotoPose;
  readonly position: 1 | 2 | 3;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly mimeType: ProgressPhotoMime;
}

export interface ProgressCheck {
  readonly id: string;
  readonly checkedOn: string;
  readonly photos: readonly ProgressCheckPhoto[];
}

export interface ProgressReportCommand {
  readonly kind: ProgressReportKind;
  readonly assetIds: readonly string[];
  readonly message: string | null;
  readonly requestId: string;
}

export interface ProgressReportItem {
  readonly position: number;
  readonly assetId: string;
  readonly assetKind: ProgressAssetKind;
  readonly bucketId: "progress-check-photos" | "progress-medical-documents";
  readonly objectName: string;
  readonly mimeType: ProgressPhotoMime | ProgressDocumentMime;
  readonly extension: ProgressPhotoExtension | ProgressDocumentExtension;
  readonly bytes: number;
  readonly checkId: string | null;
  readonly checkedOn: string | null;
  readonly pose: ProgressPhotoPose | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly displayName: string | null;
  readonly documentCategory: ProgressDocumentCategory | null;
}

export interface ProgressReport {
  readonly id: string;
  readonly kind: ProgressReportKind;
  readonly message: string | null;
  readonly sentAt: string;
  readonly reviewedAt: string | null;
  readonly items: readonly ProgressReportItem[];
}

export interface ProgressDeliveryIntent {
  readonly reportId: string;
  readonly recipient: "linked_coach";
  readonly channel: "in_app" | "email";
  readonly eventKind: "progress_report_received";
  readonly state: "pending_implementation";
  readonly includesAttachment: false;
  readonly includesMediaUrl: false;
}

export type ProgressRecordsRpcName =
  | "get_own_student_progress_access"
  | "create_own_progress_report"
  | "get_own_student_progress_report"
  | "get_own_coach_progress_report"
  | "review_own_coach_progress_report";

export class ProgressContractError extends Error {
  constructor(readonly code: "invalid_format" | "file_too_large" | "invalid_report") {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSION: Readonly<Record<ProgressPhotoMime, readonly ProgressPhotoExtension[]>> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
};
const DOCUMENT_CATEGORIES = new Set<ProgressDocumentCategory>([
  "examen_medico", "informe_medico", "receta", "nutricion", "otro",
]);

export function validateProgressUploadDraft(input: ProgressUploadDraft): ProgressUploadDraft {
  if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) {
    throw new ProgressContractError("invalid_format");
  }
  if (input.kind === "photo") {
    if (input.bytes > PROGRESS_PHOTO_MAX_BYTES) throw new ProgressContractError("file_too_large");
    const allowedExtensions = MIME_EXTENSION[input.mimeType];
    if (!allowedExtensions || !allowedExtensions.includes(input.extension)) {
      throw new ProgressContractError("invalid_format");
    }
    return { ...input };
  }
  if (
    input.kind !== "medical_document"
    || input.mimeType !== "application/pdf"
    || input.extension !== "pdf"
    || !DOCUMENT_CATEGORIES.has(input.category)
  ) {
    throw new ProgressContractError("invalid_format");
  }
  if (input.bytes > PROGRESS_DOCUMENT_MAX_BYTES) throw new ProgressContractError("file_too_large");
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 160 || /[\r\n]/.test(displayName)) {
    throw new ProgressContractError("invalid_format");
  }
  return { ...input, displayName };
}

export function normalizeProgressReportCommand(input: ProgressReportCommand): ProgressReportCommand {
  if (
    (input.kind !== "photos" && input.kind !== "medical_document")
    || !UUID.test(input.requestId)
    || input.assetIds.length < 1
    || input.assetIds.length > PROGRESS_REPORT_MAX_ITEMS
    || input.assetIds.some((assetId) => !UUID.test(assetId))
    || new Set(input.assetIds).size !== input.assetIds.length
    || (input.kind === "medical_document" && input.assetIds.length !== 1)
  ) {
    throw new ProgressContractError("invalid_report");
  }
  const message = input.message?.trim() || null;
  if (message && message.length > PROGRESS_REPORT_MAX_MESSAGE_LENGTH) {
    throw new ProgressContractError("invalid_report");
  }
  return { kind: input.kind, assetIds: [...input.assetIds], message, requestId: input.requestId };
}
