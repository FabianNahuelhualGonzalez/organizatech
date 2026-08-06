import type { ProfileGender } from "@/lib/profile/profile-form";

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
