import { getSantiagoDateKey } from "@/lib/training/santiago-training-date";
import { removeAccents } from "@/lib/training/exercise-name-normalization";

/** Compatibility keys for ordered weekly routines, never performed weekdays. */
export const FLEXIBLE_ROUTINE_SLOTS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

export type FlexibleRoutineSlot = (typeof FLEXIBLE_ROUTINE_SLOTS)[number];

export function flexibleRoutineLabel(slot: string): string {
  const normalized = removeAccents(slot.toLowerCase());
  const index = FLEXIBLE_ROUTINE_SLOTS.findIndex((candidate) => candidate === normalized);
  const spanishIndex = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].indexOf(normalized);
  const position = index < 0 ? spanishIndex : index;
  return position < 0 ? "Rutina" : `Rutina ${String.fromCharCode(65 + position)}`;
}

export function isFlexibleTrainingPlan(snapshot: Record<string, unknown> | null | undefined): boolean {
  const nested = snapshot?.plan;
  return snapshot?.scheduleMode === "flexible" ||
    (typeof nested === "object" && nested !== null && !Array.isArray(nested) &&
      (nested as Record<string, unknown>).scheduleMode === "flexible");
}

export function getFlexibleTrainingStartDate(startedAt: string | null | undefined): string | null {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return null;
  return getSantiagoDateKey(new Date(startedAt));
}

export function flexibleCompletionTitle(slot: string, trainedDate: string): string {
  return `${flexibleRoutineLabel(slot)} completada · ${formatFlexibleTrainingDate(trainedDate)}`;
}

export function formatFlexibleTrainingDate(trainedDate: string): string {
  const date = new Date(`${trainedDate}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date)
    : trainedDate;
}
