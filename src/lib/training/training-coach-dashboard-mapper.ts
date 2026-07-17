import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type { ExerciseEntry, ExerciseMetrics, WeeklySummary } from "@/lib/progress/types";
import type {
  CoachComparisonStatus,
  TrainingCoachFeedbackInput,
  TrainingCoachReadiness,
  TrainingCoachWeeklyTrend,
  TrainingCoachWeeklyTrendWeek,
} from "@/lib/training/training-coach-feedback";

export interface TrainingCoachActiveDayCoverage {
  registeredExercises: number;
  plannedExercises: number;
}

export interface TrainingCoachDashboardInput {
  activeDay: string;
  activeDayCoverage: TrainingCoachActiveDayCoverage;
  summary: WeeklySummary;
  currentMetrics: ExerciseMetrics[];
  /** Entries already scoped to the active day, including its historical records. */
  entries: ExerciseEntry[];
  currentWeek: number;
  /** Global weekly context. It must never decide the active-day comparison status. */
  weeklyEquivalentProgress: Pick<WeeklyEquivalentProgressResult, "status">;
}

export function buildTrainingCoachDashboardInput(input: TrainingCoachDashboardInput): TrainingCoachFeedbackInput {
  const activeDayComparison = resolveActiveDayComparison(input);
  const comparisonStatus = activeDayComparison.status;
  const readiness = resolveDashboardReadiness(input.entries, input.currentWeek);
  const weeklyTrend = buildDashboardWeeklyTrend(input.entries, input.currentWeek);
  const seed = [
    "coach",
    input.activeDay.trim(),
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
        repsDifference: finiteOrNull(
          resolveComparableRepsDifference(metric, input.entries, activeDayComparison.referenceWeek) ?? metric.repsDifference,
        ),
        volumeDifference: finiteOrNull(metric.volumeDifference),
        volumePercentage: finiteOrNull(metric.volumePercentage),
      }))
      .filter((exercise) => exercise.name.length > 0),
    readiness,
    currentWeek: finiteOrNull(input.currentWeek),
    referenceWeek: activeDayComparison.referenceWeek,
    weeklyTrend,
    seed,
  };
}

interface ActiveDayComparison {
  status: CoachComparisonStatus;
  referenceWeek: number | null;
}

function resolveActiveDayComparison(input: TrainingCoachDashboardInput): ActiveDayComparison {
  const currentWeek = safeInteger(input.currentWeek);
  const currentMetrics = input.currentMetrics.filter((metric) => (
    safeInteger(metric.week) === currentWeek &&
    metric.exerciseName.trim().length > 0 &&
    metric.reps.some((rep) => safeNumber(rep) > 0)
  ));
  const hasCurrentEntry = input.entries.some((entry) => (
    safeInteger(entry.week) === currentWeek && entry.reps.some((rep) => safeNumber(rep) > 0)
  ));
  const registeredExercises = Math.max(0, safeInteger(input.activeDayCoverage.registeredExercises));
  const plannedExercises = Math.max(0, safeInteger(input.activeDayCoverage.plannedExercises));
  const hasCurrentRecords = currentMetrics.length > 0 || hasCurrentEntry || registeredExercises > 0;

  if (!hasCurrentRecords) {
    return { status: "none", referenceWeek: null };
  }

  const isPartiallyRegistered = plannedExercises > 0 && registeredExercises < plannedExercises;
  if (isPartiallyRegistered || currentMetrics.length === 0) {
    return { status: "first_reference", referenceWeek: null };
  }

  const referenceWeek = findLatestCommonReferenceWeek(currentMetrics, input.entries, currentWeek);
  return referenceWeek === null
    ? { status: "first_reference", referenceWeek: null }
    : { status: "ready", referenceWeek };
}

function findLatestCommonReferenceWeek(metrics: ExerciseMetrics[], entries: ExerciseEntry[], currentWeek: number) {
  const referenceWeeksByMetric = metrics.map((metric) => new Set(
    findComparableEntries(metric, entries, currentWeek).map((entry) => safeInteger(entry.week)),
  ));
  const firstReferenceWeeks = referenceWeeksByMetric[0];
  if (!firstReferenceWeeks || firstReferenceWeeks.size === 0) return null;

  const commonWeeks = [...firstReferenceWeeks]
    .filter((week) => referenceWeeksByMetric.every((weeks) => weeks.has(week)))
    .sort((a, b) => b - a);

  return commonWeeks[0] ?? null;
}

export function buildDashboardWeeklyTrend(entries: ExerciseEntry[], currentWeek: number): TrainingCoachWeeklyTrend {
  const usefulEntries = entries
    .filter((entry) => safeInteger(entry.week) > 0)
    .filter((entry) => entry.exerciseName.trim().length > 0)
    .filter((entry) => entry.reps.some((rep) => safeNumber(rep) > 0));
  const weeks = [...new Set(usefulEntries.map((entry) => safeInteger(entry.week)))]
    .sort((a, b) => a - b);
  const weekSummaries = weeks.map((week) => buildDashboardWeeklyTrendWeek(week, usefulEntries.filter((entry) => safeInteger(entry.week) === week)));
  const missingWeeks = buildMissingWeeks(weeks);
  const weekCount = weeks.length;
  const currentWeekSummary = weekSummaries.find((week) => week.week === currentWeek) ?? null;
  const currentWeekComplete = currentWeekSummary
    ? isTrendWeekComplete(currentWeekSummary, weekSummaries)
    : false;
  const isCurrentWeekInProgress = Boolean(currentWeekSummary) && currentWeekComplete === false;

  return {
    phase: resolveTrendPhase(weekCount),
    availableWeeks: weeks,
    weekCount,
    currentWeek: safeInteger(currentWeek),
    currentWeekComplete,
    isCurrentWeekInProgress,
    missingWeeks,
    confidence: weekCount >= 4 ? "high" : weekCount >= 3 ? "medium" : "low",
    trendWindow: weekCount > 0
      ? {
          firstWeek: weeks[0]!,
          lastWeek: weeks[weeks.length - 1]!,
          weekCount,
        }
      : null,
    weeks: weekSummaries,
  };
}

function buildDashboardWeeklyTrendWeek(week: number, entries: ExerciseEntry[]): TrainingCoachWeeklyTrendWeek {
  const completedExercises = entries.filter((entry) => entry.reps.some((rep) => safeNumber(rep) > 0)).length;
  const objectiveHits = entries.filter((entry) => {
    const targetTotal = safeNumber(entry.targetSets) * safeNumber(entry.targetReps);
    const totalReps = safeNumber(sumFinite(entry.reps));
    return targetTotal > 0 && totalReps >= targetTotal;
  }).length;
  const totalReps = entries.reduce((total, entry) => total + safeNumber(sumFinite(entry.reps)), 0);
  const totalVolume = entries.reduce((total, entry) => total + safeNumber(entry.weight) * safeNumber(sumFinite(entry.reps)), 0);
  const validWeights = entries.map((entry) => safeNumber(entry.weight)).filter((weight) => weight > 0);

  return {
    week,
    totalVolume: finiteOrNull(totalVolume),
    totalReps: finiteOrNull(totalReps),
    completedExercises: finiteOrNull(completedExercises),
    totalExercises: finiteOrNull(entries.length),
    complianceRate: entries.length > 0 ? Math.round((objectiveHits / entries.length) * 100) : null,
    averageKg: validWeights.length > 0 ? roundOne(validWeights.reduce((total, weight) => total + weight, 0) / validWeights.length) : null,
    increasedLoadExercises: finiteOrNull(entries.filter((entry) => safeNumber(entry.weight) > safeNumber(entry.previousWeight)).length),
  };
}

function buildMissingWeeks(weeks: number[]) {
  if (weeks.length < 2) return [];
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  const available = new Set(weeks);
  const missing: number[] = [];
  for (let week = first; week <= last; week += 1) {
    if (!available.has(week)) missing.push(week);
  }
  return missing;
}

function resolveTrendPhase(weekCount: number): TrainingCoachWeeklyTrend["phase"] {
  if (weekCount <= 0) return "no_history";
  if (weekCount === 1) return "first_reference";
  if (weekCount === 2) return "initial_comparison";
  if (weekCount === 3) return "early_trend";
  return "reliable_history";
}

function isTrendWeekComplete(currentWeek: TrainingCoachWeeklyTrendWeek, weeks: TrainingCoachWeeklyTrendWeek[]) {
  const maxExercises = Math.max(...weeks.map((week) => safeNumber(week.completedExercises)), 0);
  const expectedExercises = Math.max(safeNumber(currentWeek.totalExercises), maxExercises);
  return expectedExercises > 0 &&
    safeNumber(currentWeek.completedExercises) >= expectedExercises &&
    safeNumber(currentWeek.complianceRate) >= 100;
}

function resolveComparableRepsDifference(metric: ExerciseMetrics, entries: ExerciseEntry[], referenceWeek: number | null) {
  if (referenceWeek === null) return null;
  const currentTotalReps = sumFinite(metric.reps);
  const previous = findComparableEntries(metric, entries, safeInteger(metric.week))
    .filter((entry) => safeInteger(entry.week) === referenceWeek)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  if (!previous) return null;
  const previousTotalReps = sumFinite(previous.reps);
  if (currentTotalReps === null || previousTotalReps === null) return null;
  return currentTotalReps - previousTotalReps;
}

function findComparableEntries(metric: ExerciseMetrics, entries: ExerciseEntry[], currentWeek: number) {
  const lineageId = metric.exerciseLineageId?.trim() || null;
  const exerciseId = metric.exerciseId;
  return entries
    .filter((entry) => safeInteger(entry.week) < safeInteger(currentWeek))
    .filter((entry) => {
      if (lineageId && entry.exerciseLineageId?.trim() === lineageId) return true;
      return !lineageId && entry.exerciseId === exerciseId;
    })
    .filter((entry) => entry.reps.some((rep) => safeNumber(rep) > 0))
    .sort((a, b) => safeInteger(b.week) - safeInteger(a.week) || b.date.localeCompare(a.date));
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
