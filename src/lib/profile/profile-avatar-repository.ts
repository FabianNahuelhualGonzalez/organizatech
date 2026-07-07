import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS,
  buildProfileAvatarDeletePayload,
  buildProfileAvatarPath,
  buildProfileAvatarUpdatePayload,
  isOwnProfileAvatarPath,
  mapProfileAvatarState,
  normalizeProfileAvatarPath,
  validateProfileAvatarFile,
  type ProfileAvatarFileLike,
  type ProfileAvatarState,
} from "@/lib/profile/profile-avatar";

interface ProfileAvatarRow {
  avatar_path: string | null;
  avatar_updated_at: string | null;
}

export class ProfileAvatarRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ProfileAvatarRepositoryError";
  }
}

export async function getProfileAvatarSignedUrl(path: string | null): Promise<string | null> {
  const normalizedPath = normalizeProfileAvatarPath(path);
  if (!normalizedPath) return null;

  const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
  if (!isOwnProfileAvatarPath(userId, normalizedPath)) return null;

  const { data, error } = await supabase
    .storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(normalizedPath, PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error) throw new ProfileAvatarRepositoryError("No se pudo obtener la foto de perfil.", error);
  return data.signedUrl || null;
}

export async function getCurrentProfileAvatar(): Promise<ProfileAvatarState> {
  const { userId } = await getAuthenticatedProfileAvatarClient();
  const row = await getProfileAvatarRow(userId);
  const normalizedPath = normalizeProfileAvatarPath(row.avatar_path);
  const avatarUrl = normalizedPath && isOwnProfileAvatarPath(userId, normalizedPath)
    ? await getProfileAvatarSignedUrl(normalizedPath)
    : null;

  return mapProfileAvatarState(row, avatarUrl);
}

export async function uploadProfileAvatar(file: File): Promise<ProfileAvatarState> {
  const validation = validateProfileAvatarFile(file as ProfileAvatarFileLike);
  if (!validation.ok) {
    throw new ProfileAvatarRepositoryError(validation.error);
  }

  const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
  const avatarPath = buildProfileAvatarPath(userId);

  const { error: uploadError } = await supabase
    .storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(avatarPath, file, {
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) throw new ProfileAvatarRepositoryError("No se pudo subir la foto de perfil.", uploadError);

  const avatarUpdatedAt = new Date().toISOString();
  const updatePayload = buildProfileAvatarUpdatePayload(avatarPath, avatarUpdatedAt);
  const { data, error: updateError } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("avatar_path,avatar_updated_at")
    .single();

  if (updateError) throw new ProfileAvatarRepositoryError("No se pudo subir la foto de perfil.", updateError);

  const avatarUrl = await getProfileAvatarSignedUrl(avatarPath);
  return mapProfileAvatarState(data as ProfileAvatarRow, avatarUrl);
}

export async function deleteProfileAvatar(): Promise<ProfileAvatarState> {
  const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
  const row = await getProfileAvatarRow(userId);
  const avatarPath = normalizeProfileAvatarPath(row.avatar_path);

  if (avatarPath && isOwnProfileAvatarPath(userId, avatarPath)) {
    const { error: removeError } = await supabase
      .storage
      .from(PROFILE_AVATAR_BUCKET)
      .remove([avatarPath]);

    if (removeError) throw new ProfileAvatarRepositoryError("No se pudo eliminar la foto de perfil.", removeError);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(buildProfileAvatarDeletePayload())
    .eq("id", userId);

  if (updateError) throw new ProfileAvatarRepositoryError("No se pudo eliminar la foto de perfil.", updateError);

  return {
    avatarPath: null,
    avatarUrl: null,
    avatarUpdatedAt: null,
  };
}

async function getAuthenticatedProfileAvatarClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ProfileAvatarRepositoryError("Inicia sesión para guardar tu foto de perfil.");

  const { data, error } = await supabase.auth.getUser();
  if (error) throw new ProfileAvatarRepositoryError("Tu sesión expiró. Vuelve a iniciar sesión.", error);

  const userId = data.user?.id;
  if (!userId) throw new ProfileAvatarRepositoryError("Inicia sesión para guardar tu foto de perfil.");

  return { supabase, userId };
}

async function getProfileAvatarRow(userId: string): Promise<ProfileAvatarRow> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ProfileAvatarRepositoryError("Inicia sesión para guardar tu foto de perfil.");

  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_path,avatar_updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new ProfileAvatarRepositoryError("No se pudo obtener la foto de perfil.", error);
  if (!data) return { avatar_path: null, avatar_updated_at: null };

  return data as ProfileAvatarRow;
}
