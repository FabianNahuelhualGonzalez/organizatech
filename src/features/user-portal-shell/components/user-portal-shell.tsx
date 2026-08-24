"use client";

import { useRef, type ReactNode } from "react";

import {
  resolveUserPortalDestinationScreen,
  type UserPortalDestinationId,
  type UserPortalLogoutHandler,
  type UserPortalNavigationModel,
  type UserPortalScreenNavigateHandler,
} from "@/features/user-portal-shell/model/user-portal-navigation";
import { createUserPortalLogoutSingleFlight } from "@/features/user-portal-shell/model/user-portal-logout-single-flight";
import type { ProfileViewModel } from "@/lib/profile/profile-view-model";
import {
  OVERLAY_INITIAL_FOCUS_ATTRIBUTE,
  useOverlayFocusManagement,
} from "@/ui/overlays/use-overlay-focus-management";

import { UserPortalDrawer } from "./user-portal-drawer";
import { UserPortalTopbar } from "./user-portal-topbar";
import styles from "./user-portal-shell.module.css";

export interface UserPortalShellProps {
  readonly profile: ProfileViewModel;
  readonly navigation: UserPortalNavigationModel;
  readonly isDrawerOpen: boolean;
  readonly isTopbarHidden: boolean;
  readonly isLogoutDisabled: boolean;
  readonly isNotificationPanelOpen: boolean;
  readonly notificationBadgeText: string | null;
  readonly notificationBadgeAriaLabel: string | null;
  readonly notificationOverlay: ReactNode;
  readonly screenHeader: ReactNode;
  readonly children: ReactNode;
  readonly avatarResetKey?: number;
  readonly onAvatarImageError?: () => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onNavigate: UserPortalScreenNavigateHandler;
  readonly onToggleNotifications: () => void;
  readonly onLogout: UserPortalLogoutHandler;
}

export function UserPortalShell({
  profile,
  navigation,
  isDrawerOpen,
  isTopbarHidden,
  isLogoutDisabled,
  isNotificationPanelOpen,
  notificationBadgeText,
  notificationBadgeAriaLabel,
  notificationOverlay,
  screenHeader,
  children,
  avatarResetKey,
  onAvatarImageError,
  onOpen,
  onClose,
  onNavigate,
  onToggleNotifications,
  onLogout,
}: UserPortalShellProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const logoutSingleFlightRef = useRef(createUserPortalLogoutSingleFlight());
  const drawerRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isDrawerOpen,
    onClose,
    canClose: true,
    restoreFocusRef: menuButtonRef,
  });

  function handleNavigate(destinationId: UserPortalDestinationId) {
    onNavigate(resolveUserPortalDestinationScreen(destinationId));
  }

  function handleLogout() {
    void logoutSingleFlightRef.current.run({
      disabled: isLogoutDisabled,
      onClose,
      onLogout,
    });
  }

  return (
    <main
      className={`app-shell ${styles.shell}`}
      data-user-portal-shell="authorized"
      data-drawer-state={isDrawerOpen ? "open" : "closed"}
    >
      <div
        className={styles.backgroundLayer}
        aria-hidden={isDrawerOpen ? "true" : undefined}
        inert={isDrawerOpen ? true : undefined}
      >
        <UserPortalTopbar
          isHidden={isTopbarHidden}
          isDrawerOpen={isDrawerOpen}
          isNotificationPanelOpen={isNotificationPanelOpen}
          notificationBadgeText={notificationBadgeText}
          notificationBadgeAriaLabel={notificationBadgeAriaLabel}
          menuButtonRef={menuButtonRef}
          onMenuToggle={isDrawerOpen ? onClose : onOpen}
          onToggleNotifications={onToggleNotifications}
        />
        {notificationOverlay}
        <div className={styles.content}>
          {screenHeader}
          {children}
        </div>
      </div>

      <UserPortalDrawer
        isOpen={isDrawerOpen}
        profile={profile}
        navigation={navigation}
        focusBoundaryRef={drawerRef}
        initialFocusAttribute={OVERLAY_INITIAL_FOCUS_ATTRIBUTE}
        isLogoutDisabled={isLogoutDisabled}
        onAvatarImageError={onAvatarImageError}
        avatarResetKey={avatarResetKey}
        onClose={onClose}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />
    </main>
  );
}
