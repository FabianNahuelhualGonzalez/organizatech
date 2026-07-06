export type ProfileAccountSource = "local" | "supabase";

export interface ProfileViewModelInput {
  displayName?: string | null;
  email?: string | null;
  dataSource: ProfileAccountSource;
  avatarUrl?: string | null;
  avatarPath?: string | null;
}

export interface ProfileViewModel {
  displayName: string;
  email: string | null;
  accountLabel: "Cuenta conectada" | "Cuenta local";
  secondaryLabel: string;
  avatarInitial: string | null;
  avatarUrl: string | null;
  avatarPath: string | null;
  isConnectedAccount: boolean;
}

const fallbackDisplayName = "Usuario Organizatech";

export function buildProfileViewModel(input: ProfileViewModelInput): ProfileViewModel {
  const normalizedName = normalizeText(input.displayName);
  const normalizedEmail = normalizeEmail(input.email);
  const emailPrefix = normalizedEmail ? normalizeText(normalizedEmail.split("@")[0]) : "";
  const displayName = normalizedName || emailPrefix || fallbackDisplayName;
  const accountLabel = input.dataSource === "supabase" ? "Cuenta conectada" : "Cuenta local";

  return {
    displayName,
    email: normalizedEmail || null,
    accountLabel,
    secondaryLabel: normalizedEmail || accountLabel,
    avatarInitial: resolveAvatarInitial(normalizedName || emailPrefix),
    avatarUrl: normalizeText(input.avatarUrl) || null,
    avatarPath: normalizeText(input.avatarPath) || null,
    isConnectedAccount: input.dataSource === "supabase",
  };
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function resolveAvatarInitial(value: string) {
  const firstVisibleCharacter = value.trim().match(/\p{L}|\p{N}/u)?.[0];
  return firstVisibleCharacter ? firstVisibleCharacter.toUpperCase() : null;
}
