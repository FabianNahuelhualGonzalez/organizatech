import { Bell } from "lucide-react";
import { IconButton } from "@/ui/buttons/icon-button";
import { NOTIFICATION_PANEL_ID } from "@/features/notifications/components/NotificationPanel";
import { AppMenuButton } from "./app-menu-button";

export interface AppTopbarTrainingMeta {
  cycleLabel: string;
  weekLabel: string;
  progressLabel: string;
}

export interface AppTopbarProps {
  isHidden: boolean;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  trainingMeta?: AppTopbarTrainingMeta | null;
  fallbackText: string;
  isNotificationPanelOpen: boolean;
  notificationBadgeText?: string | null;
  notificationBadgeAriaLabel?: string | null;
  onToggleNotifications: () => void;
}

export function AppTopbar({
  isHidden,
  isMenuOpen,
  onMenuToggle,
  trainingMeta,
  fallbackText,
  isNotificationPanelOpen,
  notificationBadgeText,
  notificationBadgeAriaLabel,
  onToggleNotifications,
}: AppTopbarProps) {
  return (
    <header className={`topbar ${isHidden ? "hidden" : ""}`}>
      <AppMenuButton isOpen={isMenuOpen} onToggle={onMenuToggle} />
      <div>
        <h1>Organizatech</h1>
        {trainingMeta ? (
          <p
            className="topbar-training-meta"
            aria-label={`${trainingMeta.cycleLabel}, ${trainingMeta.weekLabel}, ${trainingMeta.progressLabel}`}
          >
            <span>{trainingMeta.cycleLabel}</span>
            <span>{trainingMeta.weekLabel}</span>
            <span>{trainingMeta.progressLabel}</span>
          </p>
        ) : (
          <p className="eyebrow">{fallbackText}</p>
        )}
      </div>
      <div className="notification-shell">
        <IconButton
          className="notification-trigger"
          aria-label="Ver notificaciones"
          aria-expanded={isNotificationPanelOpen}
          aria-controls={NOTIFICATION_PANEL_ID}
          onClick={onToggleNotifications}
        >
          <Bell size={18} />
          {notificationBadgeText ? (
            <span className="notification-badge" aria-label={notificationBadgeAriaLabel ?? undefined}>
              {notificationBadgeText}
            </span>
          ) : null}
        </IconButton>
      </div>
    </header>
  );
}
