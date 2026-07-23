import { formatNotificationDate } from "@/lib/notifications/notification-date";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";

/**
 * Reproduce exactamente la selección "nuevas vs historial" y los textos derivados hoy embebidos en
 * `organizatech-app.tsx` (useMemo de `newNotifications`/`historyNotifications`/`unseenNotificationCount`,
 * y los textos literales del header/badge/estado del panel de notificaciones). Ningún texto, límite ni
 * criterio de orden fue reinterpretado.
 */

/** Igual a `VISIBLE_NEW_NOTIFICATIONS_LIMIT` en organizatech-app.tsx. */
export const VISIBLE_NEW_NOTIFICATIONS_LIMIT = 5;

export const NOTIFICATION_EMPTY_MESSAGE = "No tienes notificaciones por ahora.";

export interface NotificationViewLimits {
  visibleNewLimit?: number;
}

export interface NotificationViewResult {
  newNotifications: AppNotification[];
  historyNotifications: AppNotification[];
  unseenCount: number;
  seenRecordsById: Map<string, SeenNotificationRecord>;
}

/**
 * Divide `notifications` en "nuevas" (no vistas, limitadas a `visibleNewLimit`) e "historial" (vistas,
 * ordenadas por `seenAt` descendente — más recientemente vista primero). No muta `notifications` ni
 * `seenRecords`.
 */
export function selectNotificationView(
  notifications: readonly AppNotification[],
  seenRecords: readonly SeenNotificationRecord[],
  limits: NotificationViewLimits = {},
): NotificationViewResult {
  const visibleNewLimit = limits.visibleNewLimit ?? VISIBLE_NEW_NOTIFICATIONS_LIMIT;
  const seenIds = new Set(seenRecords.map((record) => record.id));
  const seenRecordsById = new Map(seenRecords.map((record) => [record.id, record] as const));

  const newNotifications = notifications
    .filter((notification) => !seenIds.has(notification.id))
    .slice(0, visibleNewLimit);
  const historyNotifications = notifications
    .filter((notification) => seenIds.has(notification.id))
    .sort((a, b) => (seenRecordsById.get(b.id)?.seenAt ?? 0) - (seenRecordsById.get(a.id)?.seenAt ?? 0));

  return {
    newNotifications,
    historyNotifications,
    unseenCount: newNotifications.length,
    seenRecordsById,
  };
}

/** Texto del subtítulo del panel: "N nueva(s) noticia(s)" / "Historial" / "Sin pendientes". */
export function buildNotificationPanelSubtitleText(unseenCount: number, totalCount: number): string {
  if (unseenCount > 0) {
    return `${unseenCount} ${unseenCount === 1 ? "nueva noticia" : "nuevas noticias"}`;
  }
  return totalCount > 0 ? "Historial" : "Sin pendientes";
}

/** Texto del badge de la campanita ("+9" por encima de 9); `null` cuando no debe mostrarse badge. */
export function buildNotificationBadgeText(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "+9" : String(unseenCount);
}

/** `aria-label` del badge; `null` cuando no debe mostrarse badge (mismo criterio que el texto). */
export function buildNotificationBadgeAriaLabel(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return `${unseenCount} notificaciones nuevas`;
}

/** Fecha de referencia a mostrar por ítem: la de "visto" si existe, si no la de creación — igual que en `NotificationGroup`. */
export function resolveNotificationItemReferenceDate(
  notification: AppNotification,
  seenRecord: SeenNotificationRecord | undefined,
): string {
  return seenRecord?.seenAt ? new Date(seenRecord.seenAt).toISOString() : notification.createdAt;
}

/** Etiqueta de estado por ítem: "Visto · <fecha>" / "Nuevo · <fecha>". `now` es opcional (mismo patrón que `formatNotificationDate`). */
export function buildNotificationItemStateLabel(isSeen: boolean, referenceDateIso: string, now?: Date): string {
  const dateLabel = now === undefined ? formatNotificationDate(referenceDateIso) : formatNotificationDate(referenceDateIso, now);
  return `${isSeen ? "Visto" : "Nuevo"} · ${dateLabel}`;
}
