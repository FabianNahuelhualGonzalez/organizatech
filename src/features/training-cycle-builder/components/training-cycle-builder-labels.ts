import {
  TRAINING_CYCLE_DAY_LABELS,
  TRAINING_CYCLE_DAY_SHORT_LABELS,
  type TrainingCycleDraftViewModel,
  type TrainingCycleWeekDay,
} from "./training-cycle-builder-contracts";
import { flexibleRoutineLabel } from "@/lib/training/flexible-training-schedule";

export function builderRoutineLabel(draft: TrainingCycleDraftViewModel, day: TrainingCycleWeekDay): string {
  return draft.scheduleMode === "flexible" ? flexibleRoutineLabel(day) : TRAINING_CYCLE_DAY_LABELS[day];
}

export function builderRoutineShortLabel(draft: TrainingCycleDraftViewModel, day: TrainingCycleWeekDay): string {
  return draft.scheduleMode === "flexible" ? flexibleRoutineLabel(day) : TRAINING_CYCLE_DAY_SHORT_LABELS[day];
}
