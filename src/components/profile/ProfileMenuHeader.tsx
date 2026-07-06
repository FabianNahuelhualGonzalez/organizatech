import type { ProfileViewModel } from "@/lib/profile/profile-view-model";
import { UserAvatar } from "./UserAvatar";

export function ProfileMenuHeader({ profile }: { profile: ProfileViewModel }) {
  return (
    <div className="profile-menu-header">
      <UserAvatar profile={profile} size="small" />
      <div className="profile-menu-copy">
        <h3>{profile.displayName}</h3>
      </div>
    </div>
  );
}
