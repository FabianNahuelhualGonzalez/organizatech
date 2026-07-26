import type { TrainingCycleId } from "@/lib/training/training-cycle-id";

export interface TrainingPlan {
  cycleType: TrainingCycleId;
  macroObjective: string;
  macroDurationMonths: number;
  mesoObjective: string;
  mesoDurationWeeks: number;
  microDurationWeeks: number;
  sessionDurationDays: number;
  trainingDays: string[];
  microFocus: string;
  sessionFocus: string;
}
