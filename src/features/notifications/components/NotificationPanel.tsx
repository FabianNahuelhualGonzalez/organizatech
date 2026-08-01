"use client";

import type {
  AppNotification,
  SeenNotificationRecord,
} from "@/lib/notifications/notification-types";

import { EmptyState } from "@/ui/feedback/empty-state";
import { useOverlayFocusManagement } from "@/ui/overlays/use-overlay-focus-management";

import { NotificationGroup } from "./NotificationGroup";

/** Id estable del panel, referenciado por `aria-controls` desde el trigger de notificaciones. */
export const NOTIFICATION_PANEL_ID = "notification-panel";

/** Id del título visible, usado por `aria-labelledby` para nombrar el diálogo. */
export const NOTIFICATION_PANEL_TITLE_ID = "notification-panel-title";

export interface NotificationPanelProps {
  isOpen: boolean;
  subtitle: string;
  totalNotificationsCount: number;
  newNotifications: AppNotification[];
  historyNotifications: AppNotification[];
  seenNotificationRecordsById: Map<string, SeenNotificationRecord>;
  emptyMessage: string;
  onClose: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}

export function NotificationPanel({
  isOpen,
  subtitle,
  totalNotificationsCount,
  newNotifications,
  historyNotifications,
  seenNotificationRecordsById,
  emptyMessage,
  onClose,
  onOpenNotification,
}: NotificationPanelProps) {
  // El hook se invoca ANTES del return condicional: las reglas de hooks exigen un orden estable
  // entre renders. Quien decide si el motor actúa es `isActive`, no el early return.
  //
  // No se marca ningún foco inicial explícito a propósito: el fallback natural del motor lleva el
  // foco a la primera `notification-item` habilitada y, cuando no hay notificaciones (el estado
  // vacío es un `<p role="status">`, no enfocable), al propio contenedor vía `tabIndex={-1}`.
  const panelRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isOpen,
    onClose,
    canClose: true,
  });

  if (!isOpen) return null;

  return (
    <>
      <button
        className="notification-backdrop"
        aria-label="Cerrar notificaciones"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id={NOTIFICATION_PANEL_ID}
        className="notification-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Notificaciones"
        aria-labelledby={NOTIFICATION_PANEL_TITLE_ID}
        tabIndex={-1}
      >
        <div className="notification-panel-header">
          <strong id={NOTIFICATION_PANEL_TITLE_ID}>Notificaciones</strong>
          <span>{subtitle}</span>
        </div>
        {totalNotificationsCount > 0 ? (
          <div className="notification-list">
            {newNotifications.length > 0 ? (
              <NotificationGroup
                title="Nuevas"
                notifications={newNotifications}
                seenNotificationRecordsById={seenNotificationRecordsById}
                onOpen={onOpenNotification}
              />
            ) : null}
            {historyNotifications.length > 0 ? (
              <NotificationGroup
                title="Historial"
                notifications={historyNotifications}
                seenNotificationRecordsById={seenNotificationRecordsById}
                onOpen={onOpenNotification}
              />
            ) : null}
          </div>
        ) : (
          <EmptyState className="notification-empty" message={emptyMessage} />
        )}
      </div>
    </>
  );
}
