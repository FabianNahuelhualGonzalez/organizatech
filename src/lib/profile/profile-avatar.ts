export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const PROFILE_AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const PROFILE_AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProfileAvatarAllowedMimeType = (typeof PROFILE_AVATAR_ALLOWED_MIME_TYPES)[number];

export type ProfileAvatarFileLike = {
  size: number;
  type: string;
  name?: string;
} | null | undefined;

export type ProfileAvatarValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const profileAvatarAllowedMimeTypeSet = new Set<string>(PROFILE_AVATAR_ALLOWED_MIME_TYPES);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateProfileAvatarFile(file: ProfileAvatarFileLike): ProfileAvatarValidationResult {
  if (!file) return { ok: false, error: "Selecciona una imagen para subir." };

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "La imagen seleccionada está vacía." };
  }

  if (size > PROFILE_AVATAR_MAX_SIZE_BYTES) {
    return { ok: false, error: "La imagen debe pesar 2 MB o menos." };
  }

  const mimeType = normalizeMimeType(file.type);
  if (!profileAvatarAllowedMimeTypeSet.has(mimeType)) {
    return { ok: false, error: "Usa una imagen JPG, PNG o WEBP." };
  }

  return { ok: true };
}

export function buildProfileAvatarPath(userId: string): string {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error("El usuario del avatar no es válido.");
  }

  return `${normalizedUserId}/avatar`;
}

export function normalizeProfileAvatarPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;

  const normalizedPath = path.trim();
  if (!normalizedPath) return null;
  if (normalizedPath.startsWith("/") || normalizedPath.includes("//") || normalizedPath.includes("..")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath)) return null;
  if (normalizedPath.startsWith(`${PROFILE_AVATAR_BUCKET}/`)) return null;

  const parts = normalizedPath.split("/");
  if (parts.length !== 2 || parts[1] !== "avatar") return null;

  const normalizedUserId = normalizeUserId(parts[0]);
  if (!normalizedUserId) return null;

  return `${normalizedUserId}/avatar`;
}

export function isOwnProfileAvatarPath(userId: string, path: string | null | undefined): boolean {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedPath = normalizeProfileAvatarPath(path);

  return Boolean(normalizedUserId && normalizedPath === `${normalizedUserId}/avatar`);
}

function normalizeMimeType(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUserId(value: string | null | undefined) {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized)) return null;
  if (normalized.includes("/") || normalized.includes("..")) return null;

  return normalized;
}
