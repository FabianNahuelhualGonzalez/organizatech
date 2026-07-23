import type { ExerciseMetrics } from "@/lib/progress/types";
import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type { ProfilePersonalData } from "@/lib/profile/profile-repository";

import type {
  AppNotification,
  AppNotificationPriority,
  AppNotificationProfileContext,
  AppNotificationWeeklySummaryContext,
  NotificationIconKey,
  TrainingNotificationContext,
} from "@/lib/notifications/notification-types";

/**
 * Reproduce exactamente `buildAppNotifications`/`createAppNotification`/`isProfilePersonalDataIncomplete`/
 * `dedupeNotifications`/`sortNotificationsByPriority`/`compareNotifications`/`getNotificationPriorityRank`/
 * `getNotificationVisual` (mapeo de categoría) de `organizatech-app.tsx`, con una única diferencia
 * deliberada: `new Date().toISOString()` se reemplaza por un parámetro `now` explícito (mismo patrón ya
 * usado en `notification-date.ts`), para que el resultado sea determinista y testeable. Ninguna regla
 * de texto, prioridad, orden, categoría o condición fue reinterpretada.
 */

export interface BuildAppNotificationsInput {
  profile: AppNotificationProfileContext;
  personalData: ProfilePersonalData | null;
  currentWeek: number;
  completedDays: number;
  plannedDays: number;
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  weeklyEquivalentProgress: WeeklyEquivalentProgressResult;
  summary: AppNotificationWeeklySummaryContext;
  currentMetrics: ExerciseMetrics[];
  todayTraining: TrainingNotificationContext | null;
}

export function buildAppNotifications(input: BuildAppNotificationsInput, now: Date = new Date()): AppNotification[] {
  const {
    profile,
    personalData,
    currentWeek,
    completedDays,
    plannedDays,
    hasTrainingEntries,
    hasRoutinePlan,
    weeklyEquivalentProgress,
    summary,
    currentMetrics,
    todayTraining,
  } = input;

  const createdAt = now.toISOString();
  const notifications: AppNotification[] = [];
  const hasWeeklyComparisonNotification = hasTrainingEntries && currentMetrics.length > 0;

  notifications.push({
    id: "feature-notification-center-v1",
    title: "Notificaciones mejoradas",
    summary: "Ahora puedes revisar novedades, historial y avances desde la campanita.",
    category: "Novedades",
    tone: "info",
    priority: "low",
    dedupeKey: "feature-notification-center",
    target: "dashboard",
    kind: "feature",
    createdAt,
  });

  if (!hasWeeklyComparisonNotification) {
    notifications.push({
      id: "feature-weekly-comparison-v1",
      title: "Comparación semanal lista",
      summary: "Ahora puedes ver tu avance frente a la semana anterior de forma más clara.",
      category: "Novedades",
      tone: "success",
      priority: hasTrainingEntries ? "medium" : "low",
      dedupeKey: "feature-weekly-comparison",
      target: "comparacion",
      section: "weekly-comparison",
      kind: "feature",
      createdAt,
    });
  }

  if (!profile.avatarUrl) {
    notifications.push({
      id: "complete-profile-v1",
      title: "Completa tu perfil",
      summary: "Agrega una foto para personalizar tu cuenta.",
      category: "Perfil",
      tone: "info",
      priority: "medium",
      dedupeKey: "profile-avatar",
      target: "perfil",
      section: "profile-avatar",
      kind: "profile",
      createdAt,
    });
  } else {
    notifications.push({
      id: "feature-avatar-editor-v1",
      title: "Foto de perfil mejorada",
      summary: "Ahora puedes subir, ajustar y recortar tu foto de perfil.",
      category: "Novedades",
      tone: "success",
      priority: "low",
      dedupeKey: "profile-avatar",
      target: "perfil",
      section: "profile-avatar",
      kind: "feature",
      createdAt,
    });
  }

  const personalDataMissing = isProfilePersonalDataIncomplete(personalData);
  if (personalDataMissing) {
    notifications.push({
      id: "complete-personal-data-v1",
      title: "Completa tus datos",
      summary: "Agrega tus datos para personalizar mejor tu experiencia.",
      category: "Perfil",
      tone: "info",
      priority: "medium",
      dedupeKey: "profile-personal-data",
      target: "perfil",
      section: "personal-data",
      kind: "profile",
      createdAt,
    });
  } else {
    notifications.push({
      id: "feature-profile-phone-v1",
      title: "Nueva mejora disponible",
      summary: "Ahora puedes agregar tu número de celular en tu perfil.",
      category: "Novedades",
      tone: "info",
      priority: "low",
      dedupeKey: "profile-personal-data",
      target: "perfil",
      section: "personal-data",
      kind: "feature",
      createdAt,
    });
  }

  if (hasRoutinePlan && plannedDays > 0 && todayTraining) {
    const isTodayCompleted = todayTraining.status === "completed";
    notifications.push({
      id: `training-status-v2-w${currentWeek}-${todayTraining.day}-${todayTraining.status}`,
      title: isTodayCompleted ? "Entrenamiento registrado" : "Hoy te toca entrenar",
      summary: isTodayCompleted
        ? "Tu rutina ya fue registrada con éxito. Puedes ver el detalle en Comparación semanal."
        : `Hoy ${todayTraining.day} te toca entrenar ${todayTraining.routine}.`,
      category: "Entrenamiento",
      tone: isTodayCompleted ? "success" : "progress",
      priority: isTodayCompleted ? "medium" : "high",
      dedupeKey: "training-status",
      target: isTodayCompleted ? "comparacion" : "dashboard",
      section: isTodayCompleted ? "weekly-comparison" : "training-carousel",
      day: todayTraining.day,
      kind: "week",
      createdAt,
    });
  } else if (!hasTrainingEntries) {
    notifications.push({
      id: `training-return-v1-w${currentWeek}`,
      title: "Retoma tu ritmo",
      summary: "Registra tu próxima sesión para mantener tu progreso.",
      category: "Entrenamiento",
      tone: "progress",
      priority: "medium",
      dedupeKey: "training-status",
      target: "dashboard",
      section: "training-carousel",
      kind: "week",
      createdAt,
    });
  }

  if (hasWeeklyComparisonNotification) {
    notifications.push({
      id: `weekly-comparison-v1-w${currentWeek}`,
      title: "Comparación semanal disponible",
      summary: "Revisa cómo avanzaste frente a tu semana anterior.",
      category: "Comparación",
      tone: "progress",
      priority: "high",
      dedupeKey: "weekly-comparison",
      target: "comparacion",
      section: "weekly-comparison",
      kind: "progress",
      createdAt,
    });
  }

  if (hasTrainingEntries && weeklyEquivalentProgress.currentEquivalentValue > 0) {
    const progressIsReady = weeklyEquivalentProgress.status === "ready";
    const progressIsPositive = weeklyEquivalentProgress.differenceValue > 0;
    const isAlmostDone = plannedDays > 0 && completedDays > 0 && completedDays >= plannedDays - 1 && completedDays < plannedDays;
    notifications.push({
      id: `weekly-progress-v1-w${currentWeek}-${Math.round(weeklyEquivalentProgress.currentEquivalentValue)}-${weeklyEquivalentProgress.tone}`,
      title: isAlmostDone
        ? "Te falta poco"
        : progressIsReady
          ? progressIsPositive
            ? "Subiste tu volumen"
            : weeklyEquivalentProgress.differenceValue < 0
              ? "Semana más baja"
              : "Buen avance semanal"
          : "Buen avance semanal",
      summary: isAlmostDone
        ? `Llevas ${completedDays} de ${plannedDays} días. Una sesión más puede cerrar muy bien la semana.`
        : progressIsReady
          ? progressIsPositive
            ? `Tu volumen actual supera a la semana anterior por ${weeklyEquivalentProgress.primaryLabel}.`
            : weeklyEquivalentProgress.differenceValue < 0
              ? `Tu volumen está ${weeklyEquivalentProgress.primaryLabel} bajo la referencia. Revísalo sin castigarte.`
              : "Tu volumen se mantiene estable frente a la semana anterior."
          : `Tu volumen actual es ${weeklyEquivalentProgress.currentVolumeLabel} esta semana.`,
      category: "Progreso",
      tone: weeklyEquivalentProgress.tone === "danger" ? "warning" : weeklyEquivalentProgress.tone === "positive" ? "success" : "progress",
      priority: progressIsReady ? "medium" : "low",
      dedupeKey: "weekly-progress",
      target: "dashboard",
      section: "weekly-progress",
      kind: "progress",
      createdAt,
    });
  }

  const mainAlert = currentMetrics.find((metric) => metric.repsDifference <= -4 && metric.kgDifference <= 0);
  const loadAdjustment = currentMetrics.find((metric) => metric.repsDifference < 0 && metric.kgDifference > 0);
  const loadIncrease = currentMetrics.find((metric) => metric.kgDifference > 0 && metric.repsDifference >= 0);
  if (mainAlert) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-attention`,
      title: "Revisa tu recuperación",
      summary: `${mainAlert.exerciseName} bajó repeticiones. Revisa descanso, técnica o fatiga acumulada.`,
      category: "Coach",
      tone: "warning",
      priority: "high",
      dedupeKey: "coach",
      target: "dashboard",
      section: "coach",
      kind: "coach",
      createdAt,
    });
  } else if (loadAdjustment) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-load-adjustment`,
      title: "Carga en consolidación",
      summary: `${loadAdjustment.exerciseName} subió peso, pero bajó reps. Consolida antes de volver a subir.`,
      category: "Coach",
      tone: "progress",
      priority: "medium",
      dedupeKey: "coach",
      target: "dashboard",
      section: "coach",
      kind: "coach",
      createdAt,
    });
  } else if (loadIncrease) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-load-up`,
      title: "Progresión de carga detectada",
      summary: `${loadIncrease.exerciseName} subió carga manteniendo rendimiento.`,
      category: "Coach",
      tone: "success",
      priority: "medium",
      dedupeKey: "coach",
      target: "dashboard",
      section: "coach",
      kind: "coach",
      createdAt,
    });
  } else if (summary.volumeDifference !== 0) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-progress`,
      title: "Análisis inteligente",
      summary: summary.volumeDifference > 0
        ? "Tu Coach detectó una mejora de volumen esta semana."
        : "Tu Coach detectó una baja de volumen y puede ayudarte a ajustar el ritmo.",
      category: "Coach",
      tone: summary.volumeDifference > 0 ? "success" : "warning",
      priority: "medium",
      dedupeKey: "coach",
      target: "dashboard",
      section: "coach",
      kind: "coach",
      createdAt,
    });
  }

  return sortNotificationsByPriority(dedupeNotifications(notifications));
}

export function isProfilePersonalDataIncomplete(personalData: ProfilePersonalData | null): boolean {
  if (!personalData) return false;
  return (
    !personalData.firstName ||
    !personalData.birthDate ||
    personalData.gender === "not_specified" ||
    !personalData.phoneNumber
  );
}

/**
 * Ante `dedupeKey` repetida, conserva la notificación de MAYOR prioridad (y más reciente en empate),
 * exactamente el criterio de `compareNotifications` — nunca la última insertada por azar de orden.
 */
export function dedupeNotifications(notifications: AppNotification[]): AppNotification[] {
  const byKey = new Map<string, AppNotification>();
  notifications.forEach((notification) => {
    const current = byKey.get(notification.dedupeKey);
    if (!current || compareNotifications(notification, current) < 0) {
      byKey.set(notification.dedupeKey, notification);
    }
  });
  return [...byKey.values()];
}

export function sortNotificationsByPriority(notifications: AppNotification[]): AppNotification[] {
  return [...notifications].sort(compareNotifications);
}

export function compareNotifications(a: AppNotification, b: AppNotification): number {
  const priorityDifference = getNotificationPriorityRank(a.priority) - getNotificationPriorityRank(b.priority);
  if (priorityDifference !== 0) return priorityDifference;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function getNotificationPriorityRank(priority: AppNotificationPriority): number {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

/** Mapeo puro categoría → clave de ícono (reproduce el switch de `getNotificationVisual`, sin JSX). */
export function resolveNotificationIconKey(category: AppNotification["category"]): NotificationIconKey {
  switch (category) {
    case "Novedades":
      return "backhoe";
    case "Progreso":
      return "heart-share";
    case "Coach":
      return "coach";
    case "Comparación":
      return "trending";
    case "Perfil":
      return "user-plus";
    case "Entrenamiento":
    case "Sistema":
      return "calendar-days";
  }
}
