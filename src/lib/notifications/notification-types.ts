import type { Screen } from "@/lib/navigation/app-navigation";

/**
 * Tipos y contratos del dominio de notificaciones (P2-E.0). Reproducen exactamente el shape hoy
 * embebido en `organizatech-app.tsx` (no se inventan campos ni categorías nuevas). Los tipos de otros
 * dominios (perfil, progreso) se referencian solo como `import type` — se borran en compilación, cero
 * acoplamiento en tiempo de ejecución — para no duplicar definiciones que ya existen en producción.
 */

export type AppNotificationTarget = Extract<Screen, "dashboard" | "perfil" | "comparacion">;

export type AppNotificationSection =
  | "profile-avatar"
  | "personal-data"
  | "today-training"
  | "training-carousel"
  | "weekly-progress"
  | "coach"
  | "weekly-comparison";

export type AppNotificationCategory =
  | "Perfil"
  | "Entrenamiento"
  | "Progreso"
  | "Comparación"
  | "Coach"
  | "Novedades"
  | "Sistema";

export type AppNotificationTone = "info" | "success" | "warning" | "progress";

export type AppNotificationPriority = "high" | "medium" | "low";

export type AppNotificationKind = "feature" | "profile" | "week" | "progress" | "coach";

export interface AppNotification {
  id: string;
  title: string;
  summary: string;
  category: AppNotificationCategory;
  tone: AppNotificationTone;
  priority: AppNotificationPriority;
  dedupeKey: string;
  target: AppNotificationTarget;
  section?: AppNotificationSection;
  day?: string;
  kind: AppNotificationKind;
  createdAt: string;
  /**
   * Declarados en el tipo productivo actual pero NUNCA asignados ni leídos por ninguna lógica real
   * hoy (confirmado por búsqueda exhaustiva en organizatech-app.tsx): no existe expiración ni motivo
   * de descarte en producción. Se preservan aquí por fidelidad estructural exacta con el tipo
   * productivo, no porque exista comportamiento asociado — no se debe inventar lógica para ellos.
   */
  expiresAt?: string;
  reason?: string;
}

/** Contexto de entrenamiento del día, ya resuelto por el dominio de entrenamiento (adaptación B, fuera de este paquete). */
export interface TrainingNotificationContext {
  day: string;
  routine: string;
  status: "completed" | "pending";
}

/** Mismo shape que `SeenNotificationStorageRecord` (`@/lib/storage/browser-storage`) — no se reimporta para no acoplar el dominio puro a la infraestructura de storage. */
export interface SeenNotificationRecord {
  id: string;
  seenAt: number;
}

/**
 * Slice mínimo explícito de los dominios de perfil/progreso que `buildAppNotifications` realmente
 * lee — en vez de importar el `ReturnType` completo de `buildProfileViewModel`/`calculateWeeklySummary`
 * (funciones ajenas a este dominio), se declara aquí solo lo consumido, manteniendo el contrato mínimo
 * y explícito que exige P2-E.0 sin depender de la forma interna completa de otro módulo.
 */
export interface AppNotificationProfileContext {
  avatarUrl: string | null;
}

export interface AppNotificationWeeklySummaryContext {
  volumeDifference: number;
}

/**
 * Intención semántica de navegación (categoría D): describe QUÉ debería ocurrir al abrir una
 * notificación, sin ejecutar ninguna navegación ni acceder a `window`/`document`. La capa de
 * integración (fuera de este paquete) traduce esto a `navigateTo`/`setDashboardDayOverride`/
 * `setComparisonDay`/scroll — reproduciendo exactamente lo que hace hoy `openNotificationTarget`.
 */
export interface NotificationOpenIntent {
  notificationId: string;
  target: AppNotificationTarget;
  dashboardDayOverride: string | null;
  comparisonDayOverride: string | null;
  section: AppNotificationSection | null;
}

/** Identificador semántico del ícono por categoría — la capa de UI decide qué componente React renderizar para cada clave. */
export type NotificationIconKey =
  | "backhoe"
  | "heart-share"
  | "coach"
  | "trending"
  | "user-plus"
  | "calendar-days";
