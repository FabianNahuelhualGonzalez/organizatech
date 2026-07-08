import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildProfilePersonalDataPayload,
  type ProfileGender,
  type ProfilePersonalDataInput,
} from "@/lib/profile/profile-form";
import { mapProfileAvatarState } from "@/lib/profile/profile-avatar";

export interface ProfilePersonalData {
  id: string;
  displayName: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  gender: ProfileGender;
  phoneNumber: string | null;
  avatarPath: string | null;
  avatarUpdatedAt: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  gender: string | null;
  phone_number: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
}

export class ProfileRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ProfileRepositoryError";
  }
}

export async function getProfilePersonalData(): Promise<ProfilePersonalData> {
  const { supabase, userId } = await getAuthenticatedProfileClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,email,first_name,last_name,birth_date,gender,phone_number,avatar_path,avatar_updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new ProfileRepositoryError("No pudimos cargar tu perfil.", error);
  if (!data) throw new ProfileRepositoryError("No encontramos tu perfil. Actualiza la sesión e intenta nuevamente.");
  return mapProfileRow(data as ProfileRow);
}

export async function updateProfilePersonalData(input: ProfilePersonalDataInput): Promise<ProfilePersonalData> {
  const validation = buildProfilePersonalDataPayload(input);
  if (!validation.ok || !validation.payload) {
    throw new ProfileRepositoryError("Revisa los datos del perfil antes de guardar.");
  }

  const { supabase, userId } = await getAuthenticatedProfileClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(validation.payload)
    .eq("id", userId)
    .select("id,display_name,email,first_name,last_name,birth_date,gender,phone_number,avatar_path,avatar_updated_at")
    .single();

  if (error) throw new ProfileRepositoryError("No pudimos guardar tu perfil.", error);
  return mapProfileRow(data as ProfileRow);
}

async function getAuthenticatedProfileClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ProfileRepositoryError("Inicia sesión para guardar tu perfil.");

  const { data, error } = await supabase.auth.getUser();
  if (error) throw new ProfileRepositoryError("Tu sesión expiró. Inicia sesión nuevamente.", error);

  const userId = data.user?.id;
  if (!userId) throw new ProfileRepositoryError("Inicia sesión para guardar tu perfil.");

  return { supabase, userId };
}

function mapProfileRow(row: ProfileRow): ProfilePersonalData {
  const avatar = mapProfileAvatarState(row, null);

  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    gender: mapGender(row.gender),
    phoneNumber: row.phone_number,
    avatarPath: avatar.avatarPath,
    avatarUpdatedAt: avatar.avatarUpdatedAt,
  };
}

function mapGender(value: string | null): ProfileGender {
  if (
    value === "male" ||
    value === "female" ||
    value === "non_binary" ||
    value === "prefer_not_to_say" ||
    value === "not_specified"
  ) {
    return value;
  }
  return "not_specified";
}
