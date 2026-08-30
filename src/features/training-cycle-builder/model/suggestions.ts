import { DEFAULT_EXERCISE_CATALOG } from "./catalog";
import { sortWeekdays } from "./draft";
import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  type ExerciseDraft,
  type RoutineDraftsByWeekday,
  type TrainingGoal,
  type TrainingDayDraft,
  type Weekday,
  isWeekday,
  isTrainingGoal,
} from "./types";

export interface SuggestedRoutineInput {
  readonly goal: TrainingGoal;
  /** Días concretos elegidos por la persona. */
  readonly selectedDays: readonly Weekday[];
  /** Diferencia término − inicio, en días calendario. */
  readonly durationDays: number;
}

export type SuggestionDurationBand = "short" | "standard" | "extended";

export interface SuggestedRoutineRationale {
  readonly inputsUsed: readonly ["goal", "selectedDays", "durationDays"];
  readonly durationBand: SuggestionDurationBand;
  readonly targetRepRange: Readonly<{ min: number; max: number }>;
  readonly baseSetCount: number;
  readonly loadPolicy: "unset_requires_user_input";
  readonly editable: true;
  readonly disclaimer: string;
}

export type SuggestedRoutineResult =
  | {
    readonly ok: true;
    readonly routines: RoutineDraftsByWeekday;
    readonly rationale: SuggestedRoutineRationale;
    readonly fingerprint: string;
  }
  | {
    readonly ok: false;
    readonly reason: "invalid_goal" | "days_empty" | "invalid_day" | "duplicate_day" | "invalid_duration" | "missing_catalog_exercise";
  };

type TemplateName = "full_body" | "upper" | "lower" | "push" | "pull" | "legs" | "lower_glutes";

interface RoutineTemplate {
  readonly name: string;
  readonly catalogExerciseIds: readonly string[];
}

const TEMPLATES: Readonly<Record<TemplateName, RoutineTemplate>> = Object.freeze({
  full_body: {
    name: "Cuerpo completo",
    catalogExerciseIds: ["back-squat", "press-flat-barbell", "lat-pulldown", "romanian-deadlift", "overhead-press", "plank"],
  },
  upper: {
    name: "Tren superior",
    catalogExerciseIds: ["press-flat-barbell", "barbell-row", "overhead-press", "lat-pulldown", "triceps-pushdown", "barbell-curl"],
  },
  lower: {
    name: "Tren inferior",
    catalogExerciseIds: ["back-squat", "romanian-deadlift", "hip-thrust", "leg-extension", "seated-calf-raise", "plank"],
  },
  push: {
    name: "Empuje",
    catalogExerciseIds: ["press-flat-barbell", "press-incline-dumbbell", "overhead-press", "lateral-raise", "triceps-pushdown"],
  },
  pull: {
    name: "Jalón",
    catalogExerciseIds: ["lat-pulldown", "barbell-row", "barbell-curl", "dumbbell-shrug"],
  },
  legs: {
    name: "Piernas",
    catalogExerciseIds: ["back-squat", "romanian-deadlift", "hip-thrust", "leg-extension", "seated-calf-raise"],
  },
  lower_glutes: {
    name: "Pierna y glúteo",
    catalogExerciseIds: ["bulgarian-split-squat", "hip-thrust", "romanian-deadlift", "cable-glute-kickback", "seated-calf-raise"],
  },
});

const SPLITS_BY_DAY_COUNT: Readonly<Record<number, readonly TemplateName[]>> = Object.freeze({
  1: ["full_body"],
  2: ["upper", "lower"],
  3: ["push", "pull", "legs"],
  4: ["upper", "lower", "upper", "lower_glutes"],
  5: ["push", "pull", "legs", "upper", "lower_glutes"],
  6: ["push", "pull", "legs", "push", "pull", "legs"],
  7: ["push", "pull", "legs", "upper", "lower_glutes", "pull", "full_body"],
});

const GOAL_PRESETS: Readonly<Record<TrainingGoal, {
  readonly repRange: Readonly<{ min: number; max: number }>;
  readonly targetReps: number;
  readonly baseSets: number;
}>> = Object.freeze({
  strength: { repRange: { min: 3, max: 6 }, targetReps: 5, baseSets: 4 },
  volume: { repRange: { min: 8, max: 12 }, targetReps: 10, baseSets: 4 },
  definition: { repRange: { min: 10, max: 15 }, targetReps: 12, baseSets: 3 },
  deload: { repRange: { min: 6, max: 10 }, targetReps: 8, baseSets: 2 },
});

/**
 * Generador determinista. No consulta historial, nivel, equipamiento, red, hora, aleatoriedad ni
 * datos personales. Las cargas quedan en 0 para exigir decisión explícita del usuario.
 */
export function generateSuggestedRoutines(input: SuggestedRoutineInput): SuggestedRoutineResult {
  if (!isTrainingGoal(input.goal)) return { ok: false, reason: "invalid_goal" };
  if (input.selectedDays.length === 0) return { ok: false, reason: "days_empty" };
  if (input.selectedDays.some((day) => !isWeekday(day))) return { ok: false, reason: "invalid_day" };
  if (new Set(input.selectedDays).size !== input.selectedDays.length) {
    return { ok: false, reason: "duplicate_day" };
  }
  if (
    !Number.isSafeInteger(input.durationDays)
    || input.durationDays < 1
    || input.durationDays > DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxCycleSpanDays
  ) return { ok: false, reason: "invalid_duration" };

  const selectedDays = sortWeekdays(input.selectedDays);
  const templates = SPLITS_BY_DAY_COUNT[selectedDays.length];
  if (!templates) return { ok: false, reason: "invalid_day" };
  const goalPreset = GOAL_PRESETS[input.goal];
  const durationBand = getDurationBand(input.durationDays);
  const setCount = Math.max(2, goalPreset.baseSets + (durationBand === "short" ? -1 : 0));
  const fingerprint = [input.goal, input.durationDays, ...selectedDays].join("|");
  const routines: Partial<Record<Weekday, TrainingDayDraft>> = {};

  for (let dayIndex = 0; dayIndex < selectedDays.length; dayIndex += 1) {
    const template = TEMPLATES[templates[dayIndex]];
    const day = selectedDays[dayIndex];
    const suggested = createSuggestedDay(
      day,
      template,
      fingerprint,
      dayIndex,
      setCount,
      goalPreset.targetReps,
    );
    if (!suggested) return { ok: false, reason: "missing_catalog_exercise" };
    routines[day] = suggested;
  }

  return {
    ok: true,
    routines,
    fingerprint,
    rationale: {
      inputsUsed: ["goal", "selectedDays", "durationDays"],
      durationBand,
      targetRepRange: goalPreset.repRange,
      baseSetCount: setCount,
      loadPolicy: "unset_requires_user_input",
      editable: true,
      disclaimer: "Son objetivos de planificación editables, no una promesa de repeticiones ni de rendimiento.",
    },
  };
}

function createSuggestedDay(
  day: Weekday,
  template: RoutineTemplate,
  fingerprint: string,
  dayIndex: number,
  setCount: number,
  targetReps: number,
): TrainingDayDraft | null {
  const exercises: ExerciseDraft[] = [];
  for (let exerciseIndex = 0; exerciseIndex < template.catalogExerciseIds.length; exerciseIndex += 1) {
    const catalogExerciseId = template.catalogExerciseIds[exerciseIndex];
    const catalogExercise = DEFAULT_EXERCISE_CATALOG.byId[catalogExerciseId];
    if (!catalogExercise) return null;
    const namespace = `suggested:${fingerprint}:day:${dayIndex + 1}:exercise:${exerciseIndex + 1}`;
    exercises.push({
      id: namespace,
      sourceExerciseId: null,
      source: { kind: "catalog", catalogExerciseId },
      name: catalogExercise.canonicalName,
      primaryMuscleGroup: catalogExercise.primaryMuscleGroup,
      loadBasis: catalogExercise.loadBasis,
      order: exerciseIndex + 1,
      technique: "linear",
      videoUrl: catalogExercise.videoUrl,
      sets: Array.from({ length: setCount }, (_, setIndex) => ({
        id: `${namespace}:set:${setIndex + 1}`,
        sourceSetId: null,
        order: setIndex + 1,
        targetReps,
        targetKg: 0,
        toFailure: false,
        drops: [],
      })),
    });
  }
  return { day, name: template.name, exercises };
}

function getDurationBand(durationDays: number): SuggestionDurationBand {
  if (durationDays <= 21) return "short";
  if (durationDays <= 84) return "standard";
  return "extended";
}
