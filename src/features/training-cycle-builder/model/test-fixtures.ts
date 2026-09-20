import { createTrainingCycleDraft } from "./draft";
import type {
  ExerciseDraft,
  SetDraft,
  TrainingCycleDraft,
  TrainingDayDraft,
} from "./types";

export function createFixtureSet(overrides: Partial<SetDraft> = {}): SetDraft {
  return {
    id: "set-1",
    sourceSetId: null,
    order: 1,
    targetReps: 10,
    targetKg: 80,
    toFailure: false,
    drops: [],
    ...overrides,
  };
}

export function createFixtureExercise(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    id: "exercise-1",
    sourceExerciseId: null,
    source: { kind: "catalog", catalogExerciseId: "press-flat-barbell" },
    name: "Press plano con barra",
    primaryMuscleGroup: "chest",
    loadBasis: "external",
    order: 1,
    technique: "linear",
    videoUrl: null,
    sets: [createFixtureSet()],
    ...overrides,
  };
}

export function createFixtureDay(overrides: Partial<TrainingDayDraft> = {}): TrainingDayDraft {
  return {
    day: "monday",
    name: "Empuje",
    exercises: [createFixtureExercise()],
    ...overrides,
  };
}

export function createFixtureDraft(overrides: Partial<TrainingCycleDraft> = {}): TrainingCycleDraft {
  const base = createTrainingCycleDraft({
    draftId: "draft-fixture",
    origin: "manual",
    goal: "volume",
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    selectedDays: ["monday"],
    routines: { monday: createFixtureDay() },
  });
  return { ...base, ...overrides };
}
