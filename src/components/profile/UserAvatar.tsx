import { User } from "lucide-react";

import type { ProfileViewModel } from "@/lib/profile/profile-view-model";

export function UserAvatar({
  profile,
  size = "medium",
}: {
  profile: Pick<ProfileViewModel, "avatarInitial" | "avatarUrl" | "displayName">;
  size?: "small" | "medium" | "large";
}) {
  const className = `user-avatar user-avatar-${size}`;

  if (profile.avatarUrl) {
    return (
      <img
        className={className}
        src={profile.avatarUrl}
        alt={`Foto de perfil de ${profile.displayName}`}
      />
    );
  }

  return (
    <div className={className} aria-label={`Avatar de ${profile.displayName}`}>
      {profile.avatarInitial ? (
        <span>{profile.avatarInitial}</span>
      ) : (
        <User size={size === "large" ? 30 : 20} aria-hidden="true" />
      )}
    </div>
  );
}
