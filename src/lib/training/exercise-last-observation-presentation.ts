import type { LatestExerciseObservation } from "@/lib/training/exercise-last-observation-repository";

export type ExerciseLastObservationPresentationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface ExerciseLastObservationPresentationInput {
  observation: LatestExerciseObservation | null;
  loading?: boolean;
  error?: string | null;
  hasQueried?: boolean;
}

export interface ExerciseLastObservationPresentation {
  status: ExerciseLastObservationPresentationStatus;
  historyLabel: string;
  historyText: string;
}

const HISTORY_LABEL = "Última observación";
const EMPTY_TEXT = "Sin observaciones anteriores.";
const LOADING_TEXT = "Cargando observación anterior…";
const ERROR_TEXT = "No pudimos cargar la observación anterior.";

export function buildExerciseLastObservationPresentation(
  input: ExerciseLastObservationPresentationInput,
): ExerciseLastObservationPresentation {
  if (input.loading) {
    return { status: "loading", historyLabel: HISTORY_LABEL, historyText: LOADING_TEXT };
  }

  if (input.error) {
    return { status: "error", historyLabel: HISTORY_LABEL, historyText: ERROR_TEXT };
  }

  if (!input.hasQueried) {
    return { status: "idle", historyLabel: HISTORY_LABEL, historyText: EMPTY_TEXT };
  }

  const text = input.observation?.observation?.trim();
  if (!text) {
    return { status: "empty", historyLabel: HISTORY_LABEL, historyText: EMPTY_TEXT };
  }

  return { status: "ready", historyLabel: HISTORY_LABEL, historyText: text };
}
