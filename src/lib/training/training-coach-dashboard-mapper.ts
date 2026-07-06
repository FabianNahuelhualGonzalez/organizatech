import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type { ExerciseEntry, ExerciseMetrics, WeeklySummary } from "@/lib/progress/types";
import type { TrainingCoachFeedbackInput, TrainingCoachReadiness } from "@/lib/training/training-coach-feedback";

export interface TrainingCoachDashboardInput {
  summary: WeeklySummary;
  currentMetrics: ExerciseMetrics[];
  entries: ExerciseEntry[];
  currentWeek: number;
  weeklyEquivalentProgress: Pick<WeeklyEquivalentProgressResult, "status">;
}

export function buildTrainingCoachDashboardInput(input: TrainingCoachDashboardInput): TrainingCoachFeedbackInput {
  const hasRealRecords = input.entries.length > 0 || input.currentMetrics.length > 0;
  const comparisonStatus = input.weeklyEquivalentProgress.status === "ready"
    ? "ready"
    : hasRealRecords
      ? "first_reference"
      : "none";
  const readiness = resolveDashboardReadiness(input.entries, input.currentWeek);
  const seed = [
    "coach",
    safeInteger(input.currentWeek),
    safeInteger(input.summary.exerciseCount),
    safeNumber(input.summary.volumeDifference),
    safeNumber(input.summary.repsDifference),
  ].join(":");

  return {
    comparisonStatus,
    workout: {
      completedExercises: finiteOrNull(input.summary.objectivesOk),
      totalExercises: finiteOrNull(input.summary.exerciseCount),
      volumeDifference: finiteOrNull(input.summary.volumeDifference),
      volumePercentage: finiteOrNull(input.summary.volumePercentage),
      repsDifference: finiteOrNull(input.summary.repsDifference),
      kgIncreasedExercises: input.currentMetrics.filter((metric) => safeNumber(metric.kgDifference) > 0).length,
      kgDecreasedExercises: input.currentMetrics.filter((metric) => safeNumber(metric.kgDifference) < 0).length,
      completedSets: sumFinite(input.currentMetrics.map((metric) => metric.completedSets)),
      totalSets: sumFinite(input.currentMetrics.map((metric) => metric.targetSets)),
    },
    exercises: input.currentMetrics
      .map((metric) => ({
        id: metric.exerciseId,
        name: metric.exerciseName.trim(),
        kgDifference: finiteOrNull(metric.kgDifference),
        repsDifference: finiteOrNull(metric.repsDifference),
        volumeDifference: finiteOrNull(metric.volumeDifference),
        volumePercentage: finiteOrNull(metric.volumePercentage),
      }))
      .filter((exercise) => exercise.name.length > 0),
    readiness,
    currentWeek: finiteOrNull(input.currentWeek),
    referenceWeek: comparisonStatus === "ready" ? Math.max(1, safeInteger(input.currentWeek) - 1) : null,
    seed,
  };
}

export function resolveDashboardReadiness(entries: ExerciseEntry[], currentWeek: number): TrainingCoachReadiness | null {
  const uniqueCheckIns = new Map<string, TrainingCoachReadiness>();

  for (const entry of entries.filter((item) => item.week === currentWeek)) {
    const parsed = parseReadinessFromNotes(entry.notes);
    if (parsed) {
      uniqueCheckIns.set(`${entry.date}-${entry.notes}`, parsed);
    }
  }

  const values = [...uniqueCheckIns.values()];
  if (values.length === 0) return null;

  return {
    motivation: average(values.map((item) => item.motivation)),
    hydration: average(values.map((item) => item.hydration)),
    sleep: average(values.map((item) => item.sleep)),
    energy: average(values.map((item) => item.energy)),
  };
}

export function parseReadinessFromNotes(notes: string | undefined): TrainingCoachReadiness | null {
  if (!notes || notes.includes("omitido")) return null;
  const match = notes.match(/motivaci[oó]n (\d+(?:\.\d+)?)\/7, hidrataci[oó]n (\d+(?:\.\d+)?)\/7, sue(?:ño|\u00C3\u00B1o) (\d+(?:\.\d+)?)\/7, energ[ií]a (\d+(?:\.\d+)?)\/7/i);
  if (!match) return null;

  const readiness = {
    motivation: finiteOrNull(Number(match[1])),
    hydration: finiteOrNull(Number(match[2])),
    sleep: finiteOrNull(Number(match[3])),
    energy: finiteOrNull(Number(match[4])),
  };

  return Object.values(readiness).every((value) => typeof value === "number") ? readiness : null;
}

function average(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? roundOne(finite.reduce((total, value) => total + value, 0) / finite.length) : null;
}

function sumFinite(values: number[]) {
  const total = values.reduce((sum, value) => Number.isFinite(value) ? sum + value : sum, 0);
  return Number.isFinite(total) ? total : null;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeInteger(value: unknown) {
  return Number.isInteger(value) ? Number(value) : 0;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
