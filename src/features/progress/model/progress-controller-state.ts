import {
  buildWeeklyExerciseComparisonModel,
  type WeeklyExerciseComparisonModel,
} from "@/lib/progress/weekly-exercise-comparison";
import type {
  ExerciseEntry,
  ExerciseTemplate,
} from "@/lib/progress/types";

const DEFAULT_PROGRESS_DAY = "Lunes";

/**
 * Estado de selección exclusivo de Progress. Los ejercicios, registros, sesiones, métricas,
 * estados de carga y errores pertenecen a sus fuentes externas y no se duplican aquí.
 */
export interface ProgressControllerState {
  selectedDay: string;
  selectedExerciseId: string | null;
  selectedWeek: number | null;
}

export type ProgressControllerAction =
  | { type: "day_selected"; day: string }
  | { type: "exercise_selected"; exerciseId: string }
  | { type: "week_selected"; week: number }
  | { type: "selection_reset" };

export interface ProgressControllerSource {
  plannedExercises: readonly ExerciseTemplate[];
  entries: readonly ExerciseEntry[];
  routineDays: readonly string[];
  currentWeek: number;
}

export interface ProgressControllerView {
  selectedDay: string;
  selectedExerciseId: string | null;
  selectedWeek: number | null;
  comparisonModel: WeeklyExerciseComparisonModel;
}

/** Cada llamada construye un estado independiente. */
export function createInitialProgressControllerState(): ProgressControllerState {
  return {
    selectedDay: DEFAULT_PROGRESS_DAY,
    selectedExerciseId: null,
    selectedWeek: null,
  };
}

/**
 * Reducer puro y exhaustivo. Las selecciones dependientes se limpian en la misma transición
 * que cambia su padre. Los payloads inválidos son no-op y conservan la referencia vigente.
 */
export function progressControllerReducer(
  state: ProgressControllerState,
  action: ProgressControllerAction,
): ProgressControllerState {
  switch (action.type) {
    case "day_selected": {
      const day = normalizeRequiredString(action.day);
      if (!day || day === state.selectedDay) return state;
      return {
        selectedDay: day,
        selectedExerciseId: null,
        selectedWeek: null,
      };
    }
    case "exercise_selected": {
      const exerciseId = normalizeRequiredString(action.exerciseId);
      if (!exerciseId || exerciseId === state.selectedExerciseId) return state;
      return {
        ...state,
        selectedExerciseId: exerciseId,
        selectedWeek: null,
      };
    }
    case "week_selected": {
      if (!isPositiveInteger(action.week) || action.week === state.selectedWeek) return state;
      return { ...state, selectedWeek: action.week };
    }
    case "selection_reset":
      return isInitialSelection(state)
        ? state
        : createInitialProgressControllerState();
    default:
      return assertNever(action);
  }
}

/**
 * Construye la vista canónica desde snapshots externos sin apropiarse de ellos. El estado guarda
 * la intención del usuario; este selector resuelve fallbacks vigentes cuando desaparecen un día,
 * un ejercicio o una semana, reutilizando el modelo semanal canónico.
 */
export function buildProgressControllerView(
  state: Readonly<ProgressControllerState>,
  source: Readonly<ProgressControllerSource>,
): ProgressControllerView {
  const selectedDay = resolveSelectedDay(state.selectedDay, source.routineDays);
  const comparisonModel = buildWeeklyExerciseComparisonModel({
    plannedExercises: [...source.plannedExercises],
    entries: [...source.entries],
    selectedDay,
    selectedExerciseId: state.selectedExerciseId,
    selectedWeek: state.selectedWeek,
    currentWeek: source.currentWeek,
  });

  return {
    selectedDay: comparisonModel.selectedDay,
    selectedExerciseId: comparisonModel.selectedExerciseId,
    selectedWeek: comparisonModel.selectedWeek,
    comparisonModel,
  };
}

function resolveSelectedDay(selectedDay: string, routineDays: readonly string[]) {
  if (routineDays.includes(selectedDay)) return selectedDay;
  return routineDays.find((day) => Boolean(normalizeRequiredString(day)))?.trim() ?? selectedDay;
}

function normalizeRequiredString(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function isInitialSelection(state: Readonly<ProgressControllerState>) {
  return state.selectedDay === DEFAULT_PROGRESS_DAY &&
    state.selectedExerciseId === null &&
    state.selectedWeek === null;
}

function assertNever(action: never): never {
  throw new Error(`Accion de Progress no reconocida: ${JSON.stringify(action)}`);
}
