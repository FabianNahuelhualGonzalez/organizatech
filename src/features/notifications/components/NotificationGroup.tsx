import { resolveNotificationIconKey } from "@/lib/notifications/notification-model";
import { buildNotificationItemStateLabel, resolveNotificationItemReferenceDate } from "@/lib/notifications/notification-selector";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";

import { renderNotificationIcon } from "@/features/notifications/components/NotificationIcons";

export interface NotificationGroupProps {
  title: string;
  notifications: AppNotification[];
  seenNotificationRecordsById: Map<string, SeenNotificationRecord>;
  onOpen: (notification: AppNotification) => void;
}

export function NotificationGroup({ title, notifications, seenNotificationRecordsById, onOpen }: NotificationGroupProps) {
  return (
    <section className="notification-group" aria-label={title}>
      {title !== "Nuevas" ? <p className="notification-group-title">{title}</p> : null}
      {notifications.map((notification) => {
        const iconKey = resolveNotificationIconKey(notification.category);
        const seenRecord = seenNotificationRecordsById.get(notification.id);
        const isSeen = Boolean(seenRecord);
        const notificationStateLabel = buildNotificationItemStateLabel(
          isSeen,
          resolveNotificationItemReferenceDate(notification, seenRecord),
        );
        return (
          <button
            type="button"
            className={`notification-item notification-${notification.kind} ${isSeen ? "seen" : "new"}`}
            key={notification.id}
            onClick={() => onOpen(notification)}
          >
            <span className="notification-icon" aria-hidden="true">{renderNotificationIcon(iconKey)}</span>
            <span className="notification-copy">
              <span className="notification-item-topline">
                <span className="notification-category">{notification.category}</span>
                <span className="notification-state">{notificationStateLabel}</span>
              </span>
              <strong>{notification.title}</strong>
              <span>{notification.summary}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
