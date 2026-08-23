"use client";

import type { ReactNode, Ref } from "react";

import type {
  UserPortalLogoutHandler,
  UserPortalNavigateHandler,
  UserPortalNavigationModel,
} from "@/features/user-portal-shell/model/user-portal-navigation";

import {
  UserPortalDrawer,
  type UserPortalVisualIdentity,
} from "./user-portal-drawer";
import {
  UserPortalTopbar,
  type UserPortalNotificationState,
} from "./user-portal-topbar";
import styles from "./user-portal-shell.module.css";

export interface UserPortalShellCandidateProps {
  readonly identity: UserPortalVisualIdentity;
  readonly navigation: UserPortalNavigationModel;
  readonly isDrawerOpen: boolean;
  readonly notifications: UserPortalNotificationState;
  readonly focusBoundaryRef?: Ref<HTMLDivElement>;
  readonly children?: ReactNode;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onNavigate: UserPortalNavigateHandler;
  readonly onToggleNotifications: () => void;
  readonly onLogout: UserPortalLogoutHandler;
}

/**
 * Candidato visual controlado y feature-local. No ejecuta navegación, sesión ni persistencia: el
 * futuro composition owner traduce sus callbacks después de completar el gate de integración.
 */
export function UserPortalShellCandidate({
  identity,
  navigation,
  isDrawerOpen,
  notifications,
  focusBoundaryRef,
  children,
  onOpen,
  onClose,
  onNavigate,
  onToggleNotifications,
  onLogout,
}: UserPortalShellCandidateProps) {
  return (
    <div
      className={styles.shell}
      data-user-portal-shell-candidate="isolated"
      data-drawer-state={isDrawerOpen ? "open" : "closed"}
    >
      <div
        className={styles.backgroundLayer}
        aria-hidden={isDrawerOpen ? "true" : undefined}
        inert={isDrawerOpen ? true : undefined}
      >
        <UserPortalTopbar
          isDrawerOpen={isDrawerOpen}
          notifications={notifications}
          onMenuToggle={isDrawerOpen ? onClose : onOpen}
          onToggleNotifications={onToggleNotifications}
        />
        <div className={styles.content}>{children}</div>
      </div>

      <UserPortalDrawer
        isOpen={isDrawerOpen}
        identity={identity}
        navigation={navigation}
        focusBoundaryRef={focusBoundaryRef}
        onClose={onClose}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
    </div>
  );
}
