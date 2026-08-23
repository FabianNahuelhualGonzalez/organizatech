"use client";

import Image from "next/image";
import { Bell, Menu } from "lucide-react";

import { USER_PORTAL_DRAWER_ID } from "@/features/user-portal-shell/model/user-portal-navigation";

import styles from "./user-portal-shell.module.css";

export type UserPortalNotificationState = {
  readonly isPanelOpen: boolean;
  readonly accessibleLabel: string;
} & (
  | { readonly hasUnread: false; readonly badgeText: null }
  | { readonly hasUnread: true; readonly badgeText: string }
);

export interface UserPortalTopbarProps {
  readonly isDrawerOpen: boolean;
  readonly notifications: UserPortalNotificationState;
  readonly onMenuToggle: () => void;
  readonly onToggleNotifications: () => void;
}

export function UserPortalTopbar({
  isDrawerOpen,
  notifications,
  onMenuToggle,
  onToggleNotifications,
}: UserPortalTopbarProps) {
  return (
    <header className={styles.topbar}>
      <button
        className={styles.iconButton}
        type="button"
        aria-label={isDrawerOpen ? "Cerrar menú Usuario" : "Abrir menú Usuario"}
        aria-expanded={isDrawerOpen}
        aria-controls={USER_PORTAL_DRAWER_ID}
        onClick={onMenuToggle}
      >
        <Menu aria-hidden="true" focusable="false" size={24} />
      </button>

      <div className={styles.brand} aria-label="Organizatech, portal Usuario">
        <Image
          className={styles.brandIcon}
          src="/icon.svg"
          width={34}
          height={34}
          alt=""
        />
        <span className={styles.brandName}>Organizatech</span>
      </div>

      <div className={styles.notificationShell}>
        <button
          className={styles.notificationButton}
          type="button"
          aria-label={notifications.accessibleLabel}
          aria-expanded={notifications.isPanelOpen}
          data-has-unread={notifications.hasUnread ? "true" : "false"}
          onClick={onToggleNotifications}
        >
          <Bell aria-hidden="true" focusable="false" size={22} />
          {notifications.hasUnread ? (
            <span className={styles.notificationBadge} aria-hidden="true">
              {notifications.badgeText}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
}
