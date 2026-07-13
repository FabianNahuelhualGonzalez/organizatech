import type { SupabaseClient } from "@supabase/supabase-js";

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

type ProfileAvatarClientFactory = () => SupabaseClient | null;

export class ProfileAvatarRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ProfileAvatarRepositoryError";
  }
}

export function createProfileAvatarRepository(
  getClient: ProfileAvatarClientFactory = getSupabaseBrowserClient,
) {
  async function getProfileAvatarSignedUrl(): Promise<string | null> {
    const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
    const row = await getProfileAvatarRow(supabase, userId);
    const avatarPath = getCanonicalStoredAvatarPath(userId, row.avatar_path);
    if (!avatarPath) return null;

    return createCanonicalSignedUrl(supabase, avatarPath);
  }

  async function getCurrentProfileAvatar(): Promise<ProfileAvatarState> {
    const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
    const row = await getProfileAvatarRow(supabase, userId);
    const avatarPath = getCanonicalStoredAvatarPath(userId, row.avatar_path);
    if (!avatarPath) return mapProfileAvatarState(null, null);

    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);
    return mapProfileAvatarState(row, avatarUrl);
  }

  async function uploadProfileAvatar(file: File): Promise<ProfileAvatarState> {
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

    // Storage and Postgres are separate operations. A complete compensation
    // strategy for failures between them remains explicitly deferred to P1.
    const avatarUpdatedAt = new Date().toISOString();
    const updatePayload = buildProfileAvatarUpdatePayload(userId, avatarUpdatedAt);
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId)
      .select("avatar_path,avatar_updated_at")
      .single();

    if (updateError) throw new ProfileAvatarRepositoryError("No se pudo subir la foto de perfil.", updateError);

    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);
    return mapProfileAvatarState(data as ProfileAvatarRow, avatarUrl);
  }

  async function deleteProfileAvatar(): Promise<ProfileAvatarState> {
    const { supabase, userId } = await getAuthenticatedProfileAvatarClient();
    const avatarPath = buildProfileAvatarPath(userId);

    const { error: removeError } = await supabase
      .storage
      .from(PROFILE_AVATAR_BUCKET)
      .remove([avatarPath]);

    if (removeError) throw new ProfileAvatarRepositoryError("No se pudo eliminar la foto de perfil.", removeError);

    // If this database update fails after Storage succeeds, the profile can
    // temporarily reference a missing object. Distributed compensation is P1.
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
    const supabase = getClient();
    if (!supabase) throw new ProfileAvatarRepositoryError("Inicia sesión para guardar tu foto de perfil.");

    const { data, error } = await supabase.auth.getUser();
    if (error) throw new ProfileAvatarRepositoryError("Tu sesión expiró. Vuelve a iniciar sesión.", error);

    const userId = data.user?.id;
    if (!userId) throw new ProfileAvatarRepositoryError("Inicia sesión para guardar tu foto de perfil.");

    return { supabase, userId };
  }

  return {
    getProfileAvatarSignedUrl,
    getCurrentProfileAvatar,
    uploadProfileAvatar,
    deleteProfileAvatar,
  };
}

async function createCanonicalSignedUrl(supabase: SupabaseClient, avatarPath: string) {
  const { data, error } = await supabase
    .storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(avatarPath, PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error) throw new ProfileAvatarRepositoryError("No se pudo obtener la foto de perfil.", error);
  return data.signedUrl || null;
}

function getCanonicalStoredAvatarPath(userId: string, storedPath: string | null) {
  const normalizedPath = normalizeProfileAvatarPath(storedPath);
  return normalizedPath && isOwnProfileAvatarPath(userId, normalizedPath)
    ? buildProfileAvatarPath(userId)
    : null;
}

async function getProfileAvatarRow(supabase: SupabaseClient, userId: string): Promise<ProfileAvatarRow> {
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_path,avatar_updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new ProfileAvatarRepositoryError("No se pudo obtener la foto de perfil.", error);
  if (!data) return { avatar_path: null, avatar_updated_at: null };

  return data as ProfileAvatarRow;
}

const profileAvatarRepository = createProfileAvatarRepository();

export const getProfileAvatarSignedUrl = profileAvatarRepository.getProfileAvatarSignedUrl;
export const getCurrentProfileAvatar = profileAvatarRepository.getCurrentProfileAvatar;
export const uploadProfileAvatar = profileAvatarRepository.uploadProfileAvatar;
export const deleteProfileAvatar = profileAvatarRepository.deleteProfileAvatar;
