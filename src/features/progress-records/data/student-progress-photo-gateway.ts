import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PROGRESS_PHOTO_MAX_BYTES, type ProgressPhotoPose } from "../model/progress-records-contract";
import { selectProgressPhoto, type StudentPhotoFormat } from "../model/select-progress-photo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OPAQUE_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}\\.(jpg|png|webp)$`, "i");
const FINAL_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}\\.(jpg|jpeg|png|webp)$`, "i");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type StudentPhotoStatus = "reservada" | "en_cola" | "procesando" | "publicada" | "fallida";
export interface StudentPhotoReservation {
  readonly uploadId: string;
  readonly bucketId: "progress-check-staging";
  readonly objectName: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly expiresAt: string;
}
export interface StudentPhotoUpload {
  readonly uploadId: string;
  readonly pose: ProgressPhotoPose;
  readonly status: StudentPhotoStatus;
  readonly assetId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly publishedAt: string | null;
}
export interface StudentPublishedPhoto {
  readonly assetId: string;
  readonly bucketId: "progress-check-photos";
  readonly objectName: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly pose: ProgressPhotoPose | null;
  readonly checkId: string | null;
  readonly createdAt: string;
  readonly availableAt: string;
}
export interface StudentPhotoCheck {
  readonly id: string;
  readonly checkedOn: string;
  readonly createdAt: string;
  readonly photos: readonly (Pick<StudentPublishedPhoto, "assetId" | "bucketId" | "objectName" | "mimeType" | "bytes" | "width" | "height"> & {
    readonly pose: ProgressPhotoPose;
    readonly position: 1 | 2 | 3;
  })[];
}
export interface StudentPhotoShareStatus {
  readonly assetId: string;
  readonly sentAt: string;
  readonly coachName: string;
}
export interface StudentProgressCoachAccess {
  readonly relationshipEpisodeId: string;
  readonly coachName: string;
  readonly coachEmail: string;
}
export interface StudentProgressReportDeliveryStatus {
  readonly emailStatus: "pending" | "sending" | "sent" | "failed" | "ambiguous";
  readonly notificationAccepted: boolean;
  readonly sentAt: string | null;
  readonly coachName: string;
  readonly coachEmail: string;
}

export class StudentProgressPhotoGatewayError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "unavailable" | "changed") {
    super(code);
    this.name = "StudentProgressPhotoGatewayError";
  }
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudentProgressPhotoGatewayError("unavailable");
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new StudentProgressPhotoGatewayError("unavailable");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new StudentProgressPhotoGatewayError("unavailable");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return value;
}
function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new StudentProgressPhotoGatewayError("unavailable");
  return Number(value);
}
function pose(value: unknown): ProgressPhotoPose {
  if (value !== "frente" && value !== "perfil" && value !== "espalda") throw new StudentProgressPhotoGatewayError("unavailable");
  return value;
}
function pages(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new StudentProgressPhotoGatewayError("invalid_input");
  }
}
function parseArray<T>(value: unknown, parser: (value: unknown) => T, max = 100): readonly T[] {
  if (!Array.isArray(value) || value.length > max) throw new StudentProgressPhotoGatewayError("unavailable");
  return value.map(parser);
}
function parseReservation(value: unknown): StudentPhotoReservation {
  const data = row(value);
  if (data.bucketId !== "progress-check-staging" || typeof data.objectName !== "string" || !OPAQUE_PATH.test(data.objectName)
    || (data.mimeType !== "image/jpeg" && data.mimeType !== "image/png"
      && data.mimeType !== "image/webp")
    || !data.objectName.endsWith(data.mimeType === "image/jpeg" ? ".jpg"
      : data.mimeType === "image/png" ? ".png" : ".webp")) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return { uploadId: uuid(data.uploadId), bucketId: data.bucketId, objectName: data.objectName,
    mimeType: data.mimeType, expiresAt: timestamp(data.expiresAt) };
}
function parseUpload(value: unknown): StudentPhotoUpload {
  const data = row(value);
  if (data.status !== "reservada" && data.status !== "en_cola" && data.status !== "procesando"
    && data.status !== "publicada" && data.status !== "fallida") throw new StudentProgressPhotoGatewayError("unavailable");
  return { uploadId: uuid(data.uploadId), pose: pose(data.pose), status: data.status,
    assetId: data.assetId === null ? null : uuid(data.assetId), createdAt: timestamp(data.createdAt),
    expiresAt: timestamp(data.expiresAt), publishedAt: data.publishedAt === null ? null : timestamp(data.publishedAt) };
}
function parseAssetFields(data: Record<string, unknown>): Pick<StudentPublishedPhoto,
  "assetId" | "bucketId" | "objectName" | "mimeType" | "bytes" | "width" | "height"> {
  if (data.bucketId !== "progress-check-photos" || typeof data.objectName !== "string" || !FINAL_PATH.test(data.objectName)
    || (data.mimeType !== "image/jpeg" && data.mimeType !== "image/png"
      && data.mimeType !== "image/webp")) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return { assetId: uuid(data.assetId), bucketId: data.bucketId as "progress-check-photos", objectName: data.objectName,
    mimeType: data.mimeType as StudentPublishedPhoto["mimeType"], bytes: positiveInteger(data.bytes), width: positiveInteger(data.width),
    height: positiveInteger(data.height) };
}
function parsePhoto(value: unknown): StudentPublishedPhoto {
  const data = row(value);
  return { ...parseAssetFields(data), pose: data.pose === null ? null : pose(data.pose),
    checkId: data.checkId === null ? null : uuid(data.checkId),
    createdAt: timestamp(data.createdAt), availableAt: timestamp(data.availableAt) };
}
function parseCheck(value: unknown): StudentPhotoCheck {
  const data = row(value);
  if (!Array.isArray(data.photos) || data.photos.length < 1 || data.photos.length > 3) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return { id: uuid(data.id), checkedOn: date(data.checkedOn), createdAt: timestamp(data.createdAt),
    photos: data.photos.map((candidate) => {
      const photo = row(candidate);
      if (photo.position !== 1 && photo.position !== 2 && photo.position !== 3) throw new StudentProgressPhotoGatewayError("unavailable");
      return { ...parseAssetFields(photo), pose: pose(photo.pose), position: photo.position };
    }) };
}
function parseShareStatus(value: unknown): StudentPhotoShareStatus {
  const data = row(value);
  if (typeof data.coachName !== "string" || !data.coachName.trim() || data.coachName.length > 201) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return { assetId: uuid(data.assetId), sentAt: timestamp(data.sentAt), coachName: data.coachName };
}
function parseDeliveryStatus(value: unknown): StudentProgressReportDeliveryStatus {
  const data = row(value);
  if (data.emailStatus !== "pending" && data.emailStatus !== "sending" && data.emailStatus !== "sent"
    && data.emailStatus !== "failed" && data.emailStatus !== "ambiguous") {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  if (typeof data.notificationAccepted !== "boolean"
    || typeof data.coachName !== "string" || !data.coachName.trim()
    || typeof data.coachEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.coachEmail)
    || (data.sentAt !== null && typeof data.sentAt !== "string")) {
    throw new StudentProgressPhotoGatewayError("unavailable");
  }
  return { emailStatus: data.emailStatus, notificationAccepted: data.notificationAccepted,
    sentAt: data.sentAt === null ? null : timestamp(data.sentAt),
    coachName: data.coachName, coachEmail: data.coachEmail };
}
function rpcError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  throw new StudentProgressPhotoGatewayError(code === "42501" ? "forbidden"
    : code === "P4090" ? "changed" : "unavailable");
}

export function createStudentProgressPhotoGateway(client: SupabaseClient) {
  const reservations = new Map<string, StudentPhotoReservation>();
  const stagedFiles = new Map<string, File>();
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await client.rpc(name, args);
    if (result.error) rpcError(result.error);
    return result.data;
  }
  async function requestServerPass(path: "publish" | "cleanup"): Promise<unknown> {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new StudentProgressPhotoGatewayError("forbidden");
    let response: Response;
    try {
      response = await fetch(`/api/progress-photos/${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
      });
    } catch { throw new StudentProgressPhotoGatewayError("unavailable"); }
    if (!response.ok) throw new StudentProgressPhotoGatewayError(
      response.status === 401 ? "forbidden" : "unavailable",
    );
    try { return (await response.json() as { status?: unknown }).status; }
    catch { throw new StudentProgressPhotoGatewayError("unavailable"); }
  }
  return {
    async reserve(poseValue: ProgressPhotoPose, format: StudentPhotoFormat): Promise<StudentPhotoReservation> {
      if (!["frente", "perfil", "espalda"].includes(poseValue)
        || (format !== "jpeg" && format !== "png" && format !== "webp")) {
        throw new StudentProgressPhotoGatewayError("invalid_input");
      }
      const reservation = parseReservation(await rpc("begin_own_progress_photo_upload", { p_pose: poseValue, p_format: format }));
      reservations.set(reservation.uploadId, reservation);
      return reservation;
    },
    async stage(uploadId: string, image: File, onProgress?: (percent: number) => void,
      signal?: AbortSignal): Promise<void> {
      const safe = reservations.get(uploadId);
      if (!safe) throw new StudentProgressPhotoGatewayError("invalid_input");
      const previousFile = stagedFiles.get(uploadId);
      if (previousFile && previousFile !== image) throw new StudentProgressPhotoGatewayError("invalid_input");
      let selected: ReturnType<typeof selectProgressPhoto>;
      try { selected = selectProgressPhoto(image); }
      catch { throw new StudentProgressPhotoGatewayError("invalid_input"); }
      const expectedMime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[selected.format];
      if (image.size < 1 || image.size > PROGRESS_PHOTO_MAX_BYTES || expectedMime !== safe.mimeType) {
        throw new StudentProgressPhotoGatewayError("invalid_input");
      }
      stagedFiles.set(uploadId, image);
      if (onProgress) {
        if (signal?.aborted) throw new StudentProgressPhotoGatewayError("unavailable");
        const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const session = await client.auth.getSession();
        if (!endpoint || !anonKey || session.error || !session.data.session?.access_token) {
          throw new StudentProgressPhotoGatewayError("forbidden");
        }
        const url = new URL(`/storage/v1/object/${safe.bucketId}/${safe.objectName}`, endpoint);
        await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", url.toString());
          const onAbort = () => request.abort();
          const release = () => signal?.removeEventListener("abort", onAbort);
          request.setRequestHeader("authorization", `Bearer ${session.data.session!.access_token}`);
          request.setRequestHeader("apikey", anonKey);
          request.setRequestHeader("content-type", safe.mimeType);
          request.setRequestHeader("x-upsert", "false");
          request.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
            }
          };
          request.onload = () => { release(); request.status >= 200 && request.status < 300
            ? resolve() : reject(new StudentProgressPhotoGatewayError("unavailable")); };
          request.onerror = () => { release(); reject(new StudentProgressPhotoGatewayError("unavailable")); };
          request.onabort = () => { release(); reject(new StudentProgressPhotoGatewayError("unavailable")); };
          if (signal?.aborted) { reject(new StudentProgressPhotoGatewayError("unavailable")); return; }
          signal?.addEventListener("abort", onAbort, { once: true });
          try { request.send(image); }
          catch { release(); reject(new StudentProgressPhotoGatewayError("unavailable")); }
        });
        return;
      }
      const { error } = await client.storage.from(safe.bucketId).upload(safe.objectName, image, {
        contentType: safe.mimeType, upsert: false,
      });
      if (error) rpcError(error);
    },
    async enqueue(uploadId: string): Promise<void> {
      if (!UUID.test(uploadId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      uuid(await rpc("finalize_own_progress_photo_upload", { p_upload_id: uploadId }));
    },
    async publishOwnBatch(): Promise<void> {
      const status = await requestServerPass("publish");
      if (status !== "published" && status !== "queued" && status !== "idle") {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
    },
    async abandon(uploadId: string): Promise<"cleaning" | "cleaned" | "published"> {
      if (!UUID.test(uploadId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      const status = await rpc("abandon_own_progress_photo_upload", { p_upload_id: uploadId });
      if (status !== "cleaning" && status !== "cleaned" && status !== "published") {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
      if (status !== "published") {
        reservations.delete(uploadId);
        stagedFiles.delete(uploadId);
      }
      return status;
    },
    async deletePublishedPhoto(assetId: string, deleteLastCheck: boolean): Promise<"photo_deleted" | "check_deleted" | "already_deleted"> {
      if (!UUID.test(assetId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      const result = await rpc(deleteLastCheck
        ? "delete_own_progress_check" : "delete_own_progress_photo",
      { p_asset_id: assetId });
      if (result !== "photo_deleted" && result !== "check_deleted" && result !== "already_deleted") {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
      return result;
    },
    async getDeletionTarget(assetId: string): Promise<"photo" | "check"> {
      if (!UUID.test(assetId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      const result = row(await rpc("get_own_progress_photo_deletion_target", { p_asset_id: assetId }));
      if (result.kind !== "photo" && result.kind !== "check") {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
      return result.kind;
    },
    async cleanupOwn(): Promise<void> {
      if (await requestServerPass("cleanup") !== "cleaning") {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
    },
    async listUploads(limit = 50, offset = 0): Promise<readonly StudentPhotoUpload[]> {
      pages(limit, offset);
      return parseArray(await rpc("list_own_progress_photo_uploads", { p_limit: limit, p_offset: offset }), parseUpload);
    },
    async getUpload(uploadId: string): Promise<StudentPhotoUpload> {
      if (!UUID.test(uploadId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      return parseUpload(await rpc("get_own_progress_photo_upload", { p_upload_id: uploadId }));
    },
    async listPhotos(limit = 50, offset = 0): Promise<readonly StudentPublishedPhoto[]> {
      pages(limit, offset);
      return parseArray(await rpc("list_own_progress_photos", { p_limit: limit, p_offset: offset }), parsePhoto);
    },
    async getPhoto(assetId: string): Promise<StudentPublishedPhoto> {
      if (!UUID.test(assetId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      return parsePhoto(await rpc("get_own_progress_photo", { p_asset_id: assetId }));
    },
    async listChecks(limit = 50, offset = 0): Promise<readonly StudentPhotoCheck[]> {
      pages(limit, offset);
      return parseArray(await rpc("list_own_progress_checks", { p_limit: limit, p_offset: offset }), parseCheck);
    },
    async createCheck(checkedOn: string, assetIds: readonly string[]): Promise<{ readonly id: string; readonly checkedOn: string }> {
      if (!DATE.test(checkedOn) || !Number.isFinite(Date.parse(`${checkedOn}T00:00:00Z`))
        || new Date(`${checkedOn}T00:00:00Z`).toISOString().slice(0, 10) !== checkedOn
        || assetIds.length < 1 || assetIds.length > 3 || assetIds.some((id) => !UUID.test(id))
        || new Set(assetIds).size !== assetIds.length) throw new StudentProgressPhotoGatewayError("invalid_input");
      const data = row(await rpc("create_own_progress_check", { p_checked_on: checkedOn, p_asset_ids: [...assetIds] }));
      return { id: uuid(data.id), checkedOn: date(data.checkedOn) };
    },
    async attachPhotoToCheck(checkId: string, assetId: string): Promise<ProgressPhotoPose> {
      if (!UUID.test(checkId) || !UUID.test(assetId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      return pose(await rpc("attach_own_progress_check_photo", { p_check_id: checkId, p_asset_id: assetId }));
    },
    async getCoachAccess(): Promise<StudentProgressCoachAccess> {
      const data = row(await rpc("get_own_student_progress_access", {}));
      if (typeof data.coachName !== "string" || !data.coachName.trim()
        || typeof data.coachEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.coachEmail)) {
        throw new StudentProgressPhotoGatewayError("unavailable");
      }
      return { relationshipEpisodeId: uuid(data.relationshipEpisodeId),
        coachName: data.coachName, coachEmail: data.coachEmail };
    },
    async listPhotoReportStatuses(assetIds: readonly string[]): Promise<readonly StudentPhotoShareStatus[]> {
      if (assetIds.length === 0) return [];
      if (assetIds.length > 150 || assetIds.some((id) => !UUID.test(id))
        || new Set(assetIds).size !== assetIds.length) throw new StudentProgressPhotoGatewayError("invalid_input");
      return parseArray(await rpc("list_own_progress_photo_report_statuses", { p_asset_ids: [...assetIds] }),
        parseShareStatus, 150);
    },
    async createPhotoReport(assetIds: readonly string[], message: string, requestId: string,
      expectedEpisodeId: string): Promise<string> {
      if (!UUID.test(requestId) || !UUID.test(expectedEpisodeId) || assetIds.length < 1 || assetIds.length > 30
        || assetIds.some((id) => !UUID.test(id)) || new Set(assetIds).size !== assetIds.length
        || message.length > 2000) throw new StudentProgressPhotoGatewayError("invalid_input");
      const data = row(await rpc("create_own_progress_photo_report", {
        p_expected_episode_id: expectedEpisodeId, p_asset_ids: [...assetIds],
        p_message: message.trim() || null, p_request_id: requestId,
      }));
      return uuid(data.id);
    },
    async getPhotoReportDeliveryStatus(reportId: string): Promise<StudentProgressReportDeliveryStatus> {
      if (!UUID.test(reportId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      return parseDeliveryStatus(await rpc("get_own_progress_report_delivery_status", { p_report_id: reportId }));
    },
    async drainOwnReportEmail(): Promise<void> {
      const { error } = await client.functions.invoke("send-evaluation-emails", { body: { kind: "progress_report" } });
      if (error) throw new StudentProgressPhotoGatewayError("unavailable");
    },
    async downloadOwnPhoto(assetId: string): Promise<Blob> {
      if (!UUID.test(assetId)) throw new StudentProgressPhotoGatewayError("invalid_input");
      const photo = parsePhoto(await rpc("get_own_progress_photo", { p_asset_id: assetId }));
      const { data, error } = await client.storage.from(photo.bucketId).download(photo.objectName);
      if (error || !data) rpcError(error);
      return data;
    },
  };
}

export function getStudentProgressPhotoGateway() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new StudentProgressPhotoGatewayError("unavailable");
  return createStudentProgressPhotoGateway(client);
}
