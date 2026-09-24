import { authenticatedProgressClient, boundedPhotoForm, privateError, PRIVATE_PHOTO_HEADERS } from "@/features/progress-records/server/photo-auth";
import { attestPhoto, cloudinaryConfig, discardUnregisteredPhoto, photoInput, uploadPhoto,
  type UploadedPhoto } from "@/features/progress-records/server/cloudinary-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await authenticatedProgressClient(request);
  if (!session) return privateError(401);
  const { error: relationshipError } = await session.client.rpc("get_own_student_progress_access");
  if (relationshipError) return privateError(403);
  let input;
  let pose: string;
  try {
    const form = await boundedPhotoForm(request);
    if ([...form.keys()].sort().join(",") !== "file,pose") return privateError(400);
    const file = form.get("file");
    const candidate = form.get("pose");
    if (!(file instanceof File) || typeof candidate !== "string" ||
      !["frente", "perfil", "espalda"].includes(candidate)) return privateError(400);
    pose = candidate;
    input = photoInput(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
  } catch (error) {
    return privateError(error instanceof Error && error.message === "photo_too_large" ? 413 : 400);
  }
  let photo: UploadedPhoto | undefined;
  try {
    const config = cloudinaryConfig(process.env);
    photo = await uploadPhoto(input, config);
    const issuedAt = Math.floor(Date.now() / 1000);
    const { data, error } = await session.client.rpc("register_own_cloudinary_progress_photo", {
      p_asset_id: photo.assetId,
      p_cloudinary_asset_id: photo.cloudinaryAssetId,
      p_mime: photo.mime,
      p_extension: photo.extension,
      p_bytes: photo.bytes,
      p_width: photo.width,
      p_height: photo.height,
      p_pose: pose,
      p_issued_at: issuedAt,
      p_attestation: attestPhoto(session.userId, photo, issuedAt, config.attestationKey),
    });
    if (error || data !== photo.assetId) throw new Error("photo_registration_failed");
    return Response.json({ assetId: photo.assetId }, { status: 201, headers: PRIVATE_PHOTO_HEADERS });
  } catch {
    if (photo) {
      try { await discardUnregisteredPhoto(photo.assetId, cloudinaryConfig(process.env)); } catch { /* QA reconciliation handles the orphan. */ }
    }
    return privateError(503);
  }
}
