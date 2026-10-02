import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PROGRESS_PHOTO_MAX_BYTES, type ProgressPhotoPose } from "../model/progress-records-contract";
import { selectProgressPhoto, type StudentPhotoFormat } from "../model/select-progress-photo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OPAQUE_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}\\.(jpg|png|webp)$`, "i");
const FINAL_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}\\.(jpg|jpeg|png|webp|heic)$`, "i");
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
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
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

export class StudentProgressPhotoGatewayError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "unavailable") {
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
function parseArray<T>(value: unknown, parser: (value: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > 100) throw new StudentProgressPhotoGatewayError("unavailable");
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
      && data.mimeType !== "image/webp" && data.mimeType !== "image/heic")) {
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
function rpcError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  throw new StudentProgressPhotoGatewayError(code === "42501" ? "forbidden" : "unavailable");
}

export function createStudentProgressPhotoGateway(client: SupabaseClient) {
  const reservations = new Map<string, StudentPhotoReservation>();
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await client.rpc(name, args);
    if (result.error) rpcError(result.error);
    return result.data;
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
    async stage(uploadId: string, image: File): Promise<void> {
      const safe = reservations.get(uploadId);
      if (!safe) throw new StudentProgressPhotoGatewayError("invalid_input");
      let selected: ReturnType<typeof selectProgressPhoto>;
      try { selected = selectProgressPhoto(image); }
      catch { throw new StudentProgressPhotoGatewayError("invalid_input"); }
      const expectedMime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[selected.format];
      if (image.size < 1 || image.size > PROGRESS_PHOTO_MAX_BYTES || expectedMime !== safe.mimeType) {
        throw new StudentProgressPhotoGatewayError("invalid_input");
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
    async listUploads(limit = 50, offset = 0): Promise<readonly StudentPhotoUpload[]> {
      pages(limit, offset);
      return parseArray(await rpc("list_own_progress_photo_uploads", { p_limit: limit, p_offset: offset }), parseUpload);
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
