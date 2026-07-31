import { formatDecimalEs, isDecimalWeightDraftInput } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";

export interface ExerciseDraft {
  weight: string;
  rir: string;
  reps: Array<number | "">;
  registered: boolean;
  observation: string;
}

export function createExerciseDraft(exercise: ExerciseTemplate): ExerciseDraft {
  return {
    weight: "",
    rir: "",
    reps: Array.from({ length: exercise.targetSets }, () => ""),
    registered: false,
    observation: "",
  };
}

export function normalizeExerciseDraft(
  exercise: ExerciseTemplate,
  draft?: ExerciseDraft,
): ExerciseDraft {
  const fallback = createExerciseDraft(exercise);
  if (!draft) return fallback;

  return {
    ...fallback,
    ...draft,
    reps: Array.from({ length: exercise.targetSets }, (_, index) => draft.reps[index] ?? ""),
    observation: normalizeDraftObservation(draft.observation),
  };
}

export function normalizeExerciseDrafts(value: unknown): Record<string, ExerciseDraft> {
  if (!value || typeof value !== "object") return {};

  const parsed = value as Record<string, Partial<ExerciseDraft> | undefined>;
  return Object.fromEntries(Object.entries(parsed).flatMap(([id, draft]) => {
    if (!draft || typeof id !== "string") return [];
    const reps = Array.isArray(draft.reps)
      ? draft.reps.map((item) => (item === "" ? "" : Number(item) || 0))
      : [];

    return [[id, {
      weight: normalizeDraftWeight(draft.weight),
      rir: typeof draft.rir === "string" ? draft.rir : "",
      reps,
      registered: Boolean(draft.registered),
      observation: normalizeDraftObservation(draft.observation),
    } satisfies ExerciseDraft]];
  }));
}

function normalizeDraftWeight(value: unknown) {
  if (typeof value === "string") return isDecimalWeightDraftInput(value) ? value : "";
  if (value === undefined) return "";
  return formatDecimalEs(Number(value) || 0);
}

function normalizeDraftObservation(value: unknown) {
  return typeof value === "string" ? value : "";
}
