import type {
  AppNotification,
  SeenNotificationRecord,
} from "@/lib/notifications/notification-types";

import { EmptyState } from "@/ui/feedback/empty-state";

import { NotificationGroup } from "./NotificationGroup";

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
  if (!isOpen) return null;

  return (
    <>
      <button
        className="notification-backdrop"
        aria-label="Cerrar notificaciones"
        onClick={onClose}
      />
      <div className="notification-panel" role="dialog" aria-label="Notificaciones">
        <div className="notification-panel-header">
          <strong>Notificaciones</strong>
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
