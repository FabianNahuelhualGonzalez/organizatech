export type TrainingCarouselStatus = "completed" | "partial" | "pending";

export interface TrainingCarouselPlannedExercise {
  id: string;
  name: string;
  targetSets?: number | null;
  targetReps?: number | null;
  baseWeight?: number | null;
}

export interface TrainingCarouselRegisteredExercise {
  id: string;
  exerciseName: string;
  targetSets?: number | null;
  totalReps?: number | null;
  weight?: number | null;
}

export interface BuildTrainingCarouselCardModelInput {
  day: string;
  routineName: string | null | undefined;
  status: TrainingCarouselStatus;
  isToday: boolean;
  registeredCount: number;
  plannedCount: number;
  registeredExercises: TrainingCarouselRegisteredExercise[];
  plannedExercises: TrainingCarouselPlannedExercise[];
  actionLabel: string;
  maxVisibleExercises?: number;
  formatWeight?: (value: number) => string;
}

export interface TrainingCarouselCardRow {
  id: string;
  name: string;
  sets: string;
  reps: string;
  kg: string;
  source: "registered" | "planned";
}

export interface TrainingCarouselCardModel {
  day: string;
  routineName: string;
  status: TrainingCarouselStatus;
  statusLabel: string;
  actionLabel: string;
  rows: TrainingCarouselCardRow[];
  additionalExerciseCount: number;
}

export interface TrainingCarouselAction {
  label: "Ver resumen" | "Ir a rutina" | "Continuar rutina";
  action: "summary" | "routine";
}

export function buildTrainingCarouselCardModel(input: BuildTrainingCarouselCardModelInput): TrainingCarouselCardModel {
  const maxVisibleExercises = Math.max(1, input.maxVisibleExercises ?? 4);
  const allRows = [
    ...input.registeredExercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.exerciseName,
      sets: formatPositiveInteger(exercise.targetSets),
      reps: formatPositiveInteger(exercise.totalReps),
      kg: formatWeightCell(exercise.weight, input.formatWeight),
      source: "registered" as const,
    })),
    ...input.plannedExercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      sets: formatPositiveInteger(exercise.targetSets),
      reps: formatPositiveInteger(exercise.targetReps),
      kg: formatWeightCell(exercise.baseWeight, input.formatWeight),
      source: "planned" as const,
    })),
  ];

  return {
    day: input.day,
    routineName: input.routineName?.trim() || "Entrenamiento",
    status: input.status,
    statusLabel: buildStatusLabel(input.status, input.registeredCount, input.plannedCount, input.isToday),
    actionLabel: input.actionLabel,
    rows: allRows.slice(0, maxVisibleExercises),
    additionalExerciseCount: Math.max(0, allRows.length - maxVisibleExercises),
  };
}

export function resolveTrainingCarouselAction(status: TrainingCarouselStatus): TrainingCarouselAction {
  if (status === "completed") return { label: "Ver resumen", action: "summary" };
  if (status === "partial") return { label: "Continuar rutina", action: "routine" };
  return { label: "Ir a rutina", action: "routine" };
}

function buildStatusLabel(status: TrainingCarouselStatus, registeredCount: number, plannedCount: number, isToday: boolean) {
  const todaySuffix = isToday ? " · Hoy" : "";
  if (status === "completed") return `Completado · ${registeredCount} de ${plannedCount}${todaySuffix}`;
  if (status === "partial") return `Parcial · ${registeredCount} de ${plannedCount}${todaySuffix}`;
  return `Pendiente · ${registeredCount} de ${plannedCount}${todaySuffix}`;
}

function formatPositiveInteger(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? String(Math.trunc(Number(value))) : "—";
}

function formatWeightCell(value: number | null | undefined, formatWeight?: (value: number) => string) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "—";
  return formatWeight ? formatWeight(Number(value)) : String(Number(value));
}
