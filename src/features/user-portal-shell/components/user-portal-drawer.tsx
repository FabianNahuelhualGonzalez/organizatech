"use client";

import Image from "next/image";
import {
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
import type { KeyboardEvent, Ref } from "react";

import {
  USER_PORTAL_DRAWER_ID,
  isUserPortalDestination,
  type UserPortalDestinationId,
  type UserPortalLogoutHandler,
  type UserPortalNavigateHandler,
  type UserPortalNavigationModel,
} from "@/features/user-portal-shell/model/user-portal-navigation";

import styles from "./user-portal-shell.module.css";

const userPortalDestinationIcons: Record<UserPortalDestinationId, LucideIcon> = {
  profile: UserRound,
  dashboard: LayoutDashboard,
  training: Dumbbell,
  comparison: ChartNoAxesCombined,
  "edit-cycle": Settings2,
  "cycle-history": History,
};

export type UserPortalAvatar =
  | {
      readonly kind: "image";
      readonly src: string;
      readonly alt: string;
    }
  | {
      readonly kind: "initials";
      readonly initials: string;
      readonly accessibleLabel: string;
    };

export interface UserPortalVisualIdentity {
  readonly displayName: string;
  /** Correo del Usuario o un contexto equivalente preparado por el futuro integrador. */
  readonly detail: string;
  readonly avatar: UserPortalAvatar;
}

export interface UserPortalDrawerProps {
  readonly isOpen: boolean;
  readonly identity: UserPortalVisualIdentity;
  readonly navigation: UserPortalNavigationModel;
  readonly focusBoundaryRef?: Ref<HTMLDivElement>;
  readonly onClose: () => void;
  readonly onNavigate: UserPortalNavigateHandler;
  readonly onLogout: UserPortalLogoutHandler;
}

/**
 * Escape cierra exclusivamente este drawer mediante `onClose`. La referencia opcional del boundary
 * permite que la integración futura entregue el gestor canónico de foco sin cambiar esta API ni
 * duplicar ahora su stack global.
 */
export function UserPortalDrawer({
  isOpen,
  identity,
  navigation,
  focusBoundaryRef,
  onClose,
  onNavigate,
  onLogout,
}: UserPortalDrawerProps) {
  if (!isOpen) return null;

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

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
        onKeyDown={handleDrawerKeyDown}
      >
        <div className={styles.drawerTopbar}>
          <h2 id="user-portal-drawer-title" className={styles.srOnly}>
            Menú Usuario
          </h2>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Cerrar menú Usuario"
            autoFocus
            onClick={onClose}
          >
            <X aria-hidden="true" focusable="false" size={24} />
          </button>
        </div>

        <div className={styles.drawerIdentity}>
          <UserPortalIdentityAvatar avatar={identity.avatar} />
          <div className={styles.identityCopy}>
            <p>{identity.displayName}</p>
            <span>{identity.detail}</span>
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
                      onClick={() => {
                        void onLogout();
                      }}
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

function UserPortalIdentityAvatar({ avatar }: { avatar: UserPortalAvatar }) {
  if (avatar.kind === "image") {
    return (
      <div className={styles.drawerAvatar}>
        <Image
          className={styles.avatarImage}
          src={avatar.src}
          alt={avatar.alt}
          fill
          sizes="58px"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div className={styles.drawerAvatar} role="img" aria-label={avatar.accessibleLabel}>
      <span className={styles.avatarInitials} aria-hidden="true">
        {avatar.initials}
      </span>
    </div>
  );
}
