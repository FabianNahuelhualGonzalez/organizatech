import { useEffect, useState } from "react";
import { User } from "lucide-react";

import type { ProfileViewModel } from "@/lib/profile/profile-view-model";

export function UserAvatar({
  profile,
  size = "medium",
  onImageError,
}: {
  profile: Pick<ProfileViewModel, "avatarInitial" | "avatarUrl" | "displayName">;
  size?: "small" | "medium" | "large";
  onImageError?: () => void;
}) {
  const className = `user-avatar user-avatar-${size}`;
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [profile.avatarUrl]);

  if (profile.avatarUrl && !imgFailed) {
    return (
      <img
        className={className}
        src={profile.avatarUrl}
        alt={`Foto de perfil de ${profile.displayName}`}
        decoding="async"
        loading={size === "large" ? "eager" : "lazy"}
        onError={() => {
          setImgFailed(true);
          onImageError?.();
        }}
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
