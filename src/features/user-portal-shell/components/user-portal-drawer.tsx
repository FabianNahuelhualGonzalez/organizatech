"use client";

import {
  CalendarDays,
  ChartNoAxesCombined,
  Dumbbell,
  History,
  LayoutDashboard,
  LogOut,
  Settings2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Ref } from "react";

import { UserAvatar } from "@/components/profile/UserAvatar";
import {
  USER_PORTAL_DRAWER_ID,
  isUserPortalDestination,
  type UserPortalDestinationId,
  type UserPortalNavigateHandler,
  type UserPortalNavigationModel,
} from "@/features/user-portal-shell/model/user-portal-navigation";
import type { ProfileViewModel } from "@/lib/profile/profile-view-model";

import styles from "./user-portal-shell.module.css";

const userPortalDestinationIcons: Record<UserPortalDestinationId, LucideIcon> = {
  profile: UserRound,
  dashboard: LayoutDashboard,
  training: Dumbbell,
  comparison: ChartNoAxesCombined,
  "edit-cycle": Settings2,
  "cycle-history": History,
  calendar: CalendarDays,
};

export interface UserPortalDrawerProps {
  readonly isOpen: boolean;
  readonly profile: ProfileViewModel;
  readonly navigation: UserPortalNavigationModel;
  readonly focusBoundaryRef?: Ref<HTMLDivElement>;
  readonly initialFocusAttribute: string;
  readonly isLogoutDisabled: boolean;
  readonly onAvatarImageError?: () => void;
  readonly avatarResetKey?: number;
  readonly onClose: () => void;
  readonly onNavigate: UserPortalNavigateHandler;
  readonly onLogout: () => void;
}

export function UserPortalDrawer({
  isOpen,
  profile,
  navigation,
  focusBoundaryRef,
  initialFocusAttribute,
  isLogoutDisabled,
  onAvatarImageError,
  avatarResetKey,
  onClose,
  onNavigate,
  onLogout,
}: UserPortalDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Cerrar menú Usuario"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={focusBoundaryRef}
        className={styles.drawer}
        id={USER_PORTAL_DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-portal-drawer-title"
        tabIndex={-1}
      >
        <div className={styles.drawerTopbar}>
          <h2 id="user-portal-drawer-title" className={styles.srOnly}>
            Menú Usuario
          </h2>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Cerrar menú Usuario"
            onClick={onClose}
            {...{ [initialFocusAttribute]: "" }}
          >
            <X aria-hidden="true" focusable="false" size={24} />
          </button>
        </div>

        <div className={styles.drawerIdentity}>
          <div className={styles.drawerAvatar}>
            <UserAvatar
              profile={profile}
              size="medium"
              onImageError={onAvatarImageError}
              resetKey={avatarResetKey}
            />
          </div>
          <div className={styles.identityCopy}>
            <p>{profile.displayName}</p>
            <span>{profile.secondaryLabel}</span>
          </div>
        </div>

        <nav aria-label="Navegación Usuario">
          <ul className={styles.menuList}>
            {navigation.items.map((item) => {
              if (item.kind === "logout") {
                return (
                  <li key={item.id} className={styles.logoutRow}>
                    <button
                      className={styles.logoutButton}
                      type="button"
                      aria-label="Cerrar sesión"
                      disabled={isLogoutDisabled}
                      aria-busy={isLogoutDisabled}
                      onClick={onLogout}
                    >
                      <LogOut aria-hidden="true" focusable="false" size={20} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              }

              if (!isUserPortalDestination(item)) return null;
              const ItemIcon = userPortalDestinationIcons[item.id];

              return (
                <li key={item.id}>
                  <button
                    className={styles.menuItem}
                    type="button"
                    aria-current={navigation.activeItemId === item.id ? "page" : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <ItemIcon aria-hidden="true" focusable="false" size={20} />
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
