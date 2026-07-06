import type { ProfileViewModel } from "@/lib/profile/profile-view-model";
import { UserAvatar } from "./UserAvatar";

export function ProfileMenuHeader({
  profile,
  onOpenProfile,
}: {
  profile: ProfileViewModel;
  onOpenProfile: () => void;
}) {
  return (
    <div className="profile-menu-header">
      <UserAvatar profile={profile} size="small" />
      <div className="profile-menu-copy">
        <p className="eyebrow">Bienvenido</p>
        <h3>{profile.displayName}</h3>
        <span>{profile.secondaryLabel}</span>
        <small>{profile.accountLabel}</small>
      </div>
      <button className="profile-shortcut" type="button" role="menuitem" onClick={onOpenProfile}>
        Mi perfil
      </button>
    </div>
  );
}
