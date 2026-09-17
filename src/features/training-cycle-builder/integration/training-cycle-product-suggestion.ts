import {
  TRAINING_CYCLE_WEEK_DAYS,
  type TrainingCycleDraftViewModel,
  type TrainingCycleGenerateSuggestedDraftInput,
  type TrainingCycleRecommendationViewModel,
} from "../components/training-cycle-builder-contracts";
import { rpcMuscleToUi } from "../data/training-cycle-rpc-mappers";
import type { TrainingCycleCatalogItem } from "../data/training-cycle-rpc-types";
import { normalizeCatalogTerm } from "../model/catalog";
import { generateSuggestedRoutines } from "../model/suggestions";

const SUGGESTED_RECOMMENDATION: TrainingCycleRecommendationViewModel = Object.freeze({
  hasHistory: false,
  title: "Carga inicial pendiente",
  body: "La rutina es editable. Define una carga cómoda antes de activarla.",
  source: "La sugerencia usa sólo objetivo, días y duración; no promete rendimiento.",
});

export function generateProductTrainingCycleSuggestion(
  input: TrainingCycleGenerateSuggestedDraftInput,
  catalog: readonly TrainingCycleCatalogItem[],
): TrainingCycleDraftViewModel {
  const generated = generateSuggestedRoutines({
    goal: input.goal,
    selectedDays: input.selectedDays,
    durationDays: input.durationDays,
  });
  if (!generated.ok) throw new Error(`training-cycle-suggestion-${generated.reason}`);

  const catalogByName = new Map(
    catalog.map((item) => [normalizeCatalogTerm(item.name), item]),
  );
  const routines = Object.fromEntries(TRAINING_CYCLE_WEEK_DAYS.map((day) => {
    const suggested = generated.routines[day];
    if (!suggested) return [day, { day, name: "", exercises: [] }];
    return [day, {
      day,
      name: suggested.name,
      exercises: suggested.exercises.map((exercise) => {
        const item = catalogByName.get(normalizeCatalogTerm(exercise.name));
        if (!item) throw new Error("training-cycle-suggestion-catalog-mismatch");
        return {
          id: exercise.id,
          source: item.source,
          name: item.name,
          muscleGroup: rpcMuscleToUi(item.muscleGroup),
          technique: exercise.technique,
          videoUrl: item.videoUrl ?? "",
          sets: exercise.sets.map((set) => ({
            id: set.id,
            targetReps: String(set.targetReps),
            targetKg: String(set.targetKg),
            toFailure: set.toFailure,
            drops: set.drops.map((drop) => ({
              id: drop.id,
              targetKg: String(drop.kg),
              targetReps: String(drop.reps),
            })),
          })),
          recommendation: SUGGESTED_RECOMMENDATION,
          recommendationDecision: "idle" as const,
        };
      }),
    }];
  })) as unknown as TrainingCycleDraftViewModel["routines"];

  return {
    draftId: `suggested:${generated.fingerprint}`,
    goal: input.goal,
    startDate: input.startDate,
    endDate: input.endDate,
    selectedDays: [...input.selectedDays],
    routines,
  };
}
