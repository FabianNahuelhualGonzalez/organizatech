import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isOwnProfileAvatarPath } from "@/lib/profile/profile-avatar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PHOTO_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}[.]jpg$`, "i");
const PDF_PATH = new RegExp(`^${PATH_ID}/${PATH_ID}[.]pdf$`, "i");

type RecordRpc = "get_own_coach_student_record_subject"
  | "list_shared_student_medical_documents" | "list_shared_student_progress_photos";

interface RecordClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(token?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
  rpc(name: RecordRpc, args: Readonly<Record<string, unknown>>): PromiseLike<{
    readonly data: unknown;
    readonly error: { readonly code?: string } | null;
  }>;
  readonly storage: Pick<SupabaseClient["storage"], "from">;
}

export interface CoachStudentRecordSubject {
  readonly episodeId: string;
  readonly studentUserId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly linkedAt: string;
  readonly avatarPath: string | null;
  readonly avatarUpdatedAt: string | null;
}
export interface SharedStudentDocument {
  readonly assetId: string;
  readonly bucketId: "progress-medical-documents";
  readonly objectName: string;
  readonly mimeType: "application/pdf";
  readonly bytes: number;
  readonly displayName: string;
  readonly availableAt: string;
}
export interface SharedStudentPhoto {
  readonly assetId: string;
  readonly bucketId: "progress-check-photos";
  readonly objectName: string;
  readonly mimeType: "image/jpeg";
  readonly bytes: number;
  readonly checkId: string;
  readonly checkedOn: string;
  readonly pose: string;
}
export class CoachStudentRecordError extends Error {
  constructor(readonly code: "invalid" | "forbidden" | "unavailable") {
    super(code);
    this.name = "CoachStudentRecordError";
  }
}
function invalid(): never { throw new CoachStudentRecordError("unavailable"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}
function bytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 25 * 1024 * 1024) invalid();
  return Number(value);
}
function page(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return value;
}
function subject(value: unknown): CoachStudentRecordSubject {
  const row = object(value);
  const studentUserId = uuid(row.studentUserId);
  const avatarPath = row.avatarPath == null ? null : text(row.avatarPath, 80);
  if (avatarPath && !isOwnProfileAvatarPath(studentUserId, avatarPath)) invalid();
  return {
    episodeId: uuid(row.episodeId), studentUserId,
    studentName: text(row.studentName, 201), studentEmail: text(row.studentEmail, 254),
    linkedAt: timestamp(row.linkedAt),
    avatarPath,
    avatarUpdatedAt: row.avatarUpdatedAt == null ? null : timestamp(row.avatarUpdatedAt),
  };
}
function document(value: unknown): SharedStudentDocument {
  const row = object(value);
  if (row.bucketId !== "progress-medical-documents" || row.mimeType !== "application/pdf"
    || typeof row.objectName !== "string" || !PDF_PATH.test(row.objectName)) invalid();
  return {
    assetId: uuid(row.assetId), bucketId: row.bucketId,
    objectName: row.objectName, mimeType: row.mimeType,
    bytes: bytes(row.bytes), displayName: text(row.displayName, 160),
    availableAt: timestamp(row.availableAt),
  };
}
function photo(value: unknown): SharedStudentPhoto {
  const row = object(value);
  if (row.bucketId !== "progress-check-photos" || row.mimeType !== "image/jpeg"
    || typeof row.objectName !== "string" || !PHOTO_PATH.test(row.objectName)) invalid();
  const checkedOn = text(row.checkedOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) invalid();
  return {
    assetId: uuid(row.assetId), bucketId: row.bucketId,
    objectName: row.objectName, mimeType: row.mimeType, bytes: bytes(row.bytes),
    checkId: uuid(row.checkId), checkedOn, pose: text(row.pose, 30),
  };
}
function pagination(limit: number, offset: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new CoachStudentRecordError("invalid");
  }
}

export function createCoachStudentRecordGateway(
  client: RecordClient, expectedCoachId: string, episodeId: string, isCurrent: () => boolean,
) {
  if (!UUID.test(expectedCoachId) || !UUID.test(episodeId)) {
    throw new CoachStudentRecordError("invalid");
  }
  async function verify() {
    if (!isCurrent()) throw new CoachStudentRecordError("forbidden");
    const { data, error } = await client.auth.getSession();
    const session = data.session;
    if (error || !session?.access_token || session.user.id !== expectedCoachId) {
      throw new CoachStudentRecordError("forbidden");
    }
    const principal = await client.auth.getUser(session.access_token);
    if (principal.error || principal.data.user?.id !== expectedCoachId || !isCurrent()) {
      throw new CoachStudentRecordError("forbidden");
    }
  }
  async function rpc(name: RecordRpc, args: Readonly<Record<string, unknown>>) {
    await verify();
    const result = await client.rpc(name, args);
    if (result.error) throw new CoachStudentRecordError(
      result.error.code === "42501" ? "forbidden" : "unavailable");
    await verify();
    return result.data;
  }
  async function getSubject() {
    const result = subject(await rpc("get_own_coach_student_record_subject", {
      p_episode_id: episodeId,
    }));
    if (result.episodeId !== episodeId) invalid();
    return result;
  }
  return {
    getSubject,
    async listDocuments(limit = 50, offset = 0): Promise<readonly SharedStudentDocument[]> {
      pagination(limit, offset);
      const selected = await getSubject();
      const result = page(await rpc("list_shared_student_medical_documents", {
        p_student_user_id: selected.studentUserId, p_limit: limit, p_offset: offset,
      }), limit).map(document);
      // The existing document RPC checks the current Coach/student relationship;
      // this second check also rejects a stale episode after re-linking.
      await getSubject();
      return result;
    },
    async listPhotos(limit = 50, offset = 0): Promise<readonly SharedStudentPhoto[]> {
      pagination(limit, offset);
      return page(await rpc("list_shared_student_progress_photos", {
        p_episode_id: episodeId, p_limit: limit, p_offset: offset,
      }), limit).map(photo);
    },
    async download(asset: SharedStudentDocument | SharedStudentPhoto): Promise<Blob> {
      const validated = asset.bucketId === "progress-medical-documents"
        ? document(asset) : photo(asset);
      await getSubject();
      const { data, error } = await client.storage.from(validated.bucketId).download(validated.objectName);
      if (error || !data) throw new CoachStudentRecordError("unavailable");
      await getSubject();
      return data;
    },
    async downloadAvatar(expected: CoachStudentRecordSubject): Promise<Blob> {
      const selected = await getSubject();
      if (selected.studentUserId !== expected.studentUserId || !selected.avatarPath
        || selected.avatarPath !== expected.avatarPath
        || selected.avatarUpdatedAt !== expected.avatarUpdatedAt) invalid();
      const { data, error } = await client.storage.from("profile-avatars").download(selected.avatarPath);
      if (error || !data) throw new CoachStudentRecordError("unavailable");
      const after = await getSubject();
      if (after.studentUserId !== selected.studentUserId || after.avatarPath !== selected.avatarPath
        || after.avatarUpdatedAt !== selected.avatarUpdatedAt) invalid();
      return data;
    },
  };
}

export function getCoachStudentRecordGateway(
  expectedCoachId: string, episodeId: string, isCurrent: () => boolean,
) {
  const client = getSupabaseBrowserClient();
  if (!client) throw new CoachStudentRecordError("unavailable");
  return createCoachStudentRecordGateway(client as RecordClient,
    expectedCoachId, episodeId, isCurrent);
}
