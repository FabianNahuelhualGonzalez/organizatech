import type {
  AppNotification,
  NotificationOpenIntent,
  SeenNotificationRecord,
} from "@/lib/notifications/notification-types";

/**
 * Reproduce exactamente la transición pura de `markNotificationsSeen` (organizatech-app.tsx) — separada
 * de `setSeenNotificationRecords`/`saveSeenNotificationRecords` (efecto de React + persistencia, fuera
 * de este paquete) — y la intención semántica de navegación de `openNotificationTarget`, sin ejecutar
 * ninguna navegación real (`navigateTo`), sin acceder a `window`/`document`, y sin depender de
 * `activeBrowserStorageScopeRef`. No existe en producción un concepto de "descarte" separado de "visto"
 * (confirmado por búsqueda exhaustiva: no hay ninguna acción "dismiss" distinta de marcar como visto) —
 * este módulo no inventa uno nuevo.
 */

/** Igual a `SEEN_NOTIFICATIONS_MAX_RECORDS` en organizatech-app.tsx. */
export const SEEN_NOTIFICATIONS_MAX_RECORDS = 60;

/**
 * Marca `ids` como vistos dentro de `currentRecords`, preservando el `seenAt` de cualquier id ya visto
 * (nunca lo actualiza), asignando `now` solo a los que aún no tenían registro, reordenando por `seenAt`
 * ascendente y recortando a los últimos `maxRecords`. Si `ids` está vacío, retorna exactamente la misma
 * referencia de `currentRecords` (no-op, igual que el `return` temprano de producción antes de tocar el
 * estado). No muta `currentRecords`.
 */
export function markNotificationsSeen(
  currentRecords: readonly SeenNotificationRecord[],
  ids: readonly string[],
  now: Date = new Date(),
  maxRecords: number = SEEN_NOTIFICATIONS_MAX_RECORDS,
): readonly SeenNotificationRecord[] {
  if (ids.length === 0) return currentRecords;

  const nowMs = now.getTime();
  const recordsById = new Map(currentRecords.map((record) => [record.id, record] as const));
  ids.forEach((id) => {
    if (!recordsById.has(id)) {
      recordsById.set(id, { id, seenAt: nowMs });
    }
  });

  return Array.from(recordsById.values())
    .sort((a, b) => a.seenAt - b.seenAt)
    .slice(-maxRecords);
}

/**
 * Intención semántica al abrir una notificación: a qué pantalla ir, qué override de día aplicar (según
 * `target`, igual que las dos condiciones de `openNotificationTarget`) y a qué sección hacer scroll.
 * NO incluye marcar como visto, cerrar el panel ni limpiar el resumen de entrenamiento — esos siguen
 * siendo llamadas explícitas de la capa de integración, igual que hoy.
 */
export function resolveNotificationOpenIntent(notification: AppNotification): NotificationOpenIntent {
  return {
    notificationId: notification.id,
    target: notification.target,
    dashboardDayOverride: notification.day && notification.target === "dashboard" ? notification.day : null,
    comparisonDayOverride: notification.day && notification.target === "comparacion" ? notification.day : null,
    section: notification.section ?? null,
  };
}
