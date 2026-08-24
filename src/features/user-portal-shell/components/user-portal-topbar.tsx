"use client";

import Image from "next/image";
import { Bell, Menu } from "lucide-react";
import type { Ref } from "react";

import { NOTIFICATION_PANEL_ID } from "@/features/notifications/components/NotificationPanel";
import { USER_PORTAL_DRAWER_ID } from "@/features/user-portal-shell/model/user-portal-navigation";

import styles from "./user-portal-shell.module.css";

export interface UserPortalTopbarProps {
  readonly isHidden: boolean;
  readonly isDrawerOpen: boolean;
  readonly isNotificationPanelOpen: boolean;
  readonly notificationBadgeText: string | null;
  readonly notificationBadgeAriaLabel: string | null;
  readonly menuButtonRef?: Ref<HTMLButtonElement>;
  readonly onMenuToggle: () => void;
  readonly onToggleNotifications: () => void;
}

export function UserPortalTopbar({
  isHidden,
  isDrawerOpen,
  isNotificationPanelOpen,
  notificationBadgeText,
  notificationBadgeAriaLabel,
  menuButtonRef,
  onMenuToggle,
  onToggleNotifications,
}: UserPortalTopbarProps) {
  return (
    <header className={`${styles.topbar} ${isHidden ? styles.topbarHidden : ""}`}>
      <button
        ref={menuButtonRef}
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
          aria-label={notificationBadgeAriaLabel ?? "Ver notificaciones"}
          aria-expanded={isNotificationPanelOpen}
          aria-controls={NOTIFICATION_PANEL_ID}
          data-has-unread={notificationBadgeText ? "true" : "false"}
          onClick={onToggleNotifications}
        >
          <Bell aria-hidden="true" focusable="false" size={22} />
          {notificationBadgeText ? (
            <span
              className={styles.notificationBadge}
              aria-label={notificationBadgeAriaLabel ?? undefined}
            >
              {notificationBadgeText}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
}
