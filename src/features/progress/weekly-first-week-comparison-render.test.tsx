import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { WeeklyMetricSummaryView } from "@/features/progress/components/weekly-metric-summary-view";
import { WeeklyResultsPanel } from "@/features/progress/components/weekly-results-panel";
import { buildWeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";
import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";

const plannedExercise: ExerciseTemplate = {
  id: "sentadilla",
  exerciseLineageId: "sentadilla-lineage",
  routine: "Piernas",
  day: "Martes",
  name: "Sentadilla",
  targetSets: 4,
  targetReps: 8,
  baseWeight: 100,
};

function entry(week: number, reps: number[]): ExerciseEntry {
  return {
    id: `sentadilla-week-${week}`,
    exerciseId: "sentadilla",
    exerciseLineageId: "sentadilla-lineage",
    exerciseName: "Sentadilla",
    routine: "Piernas",
    week,
    date: `2026-06-${week === 1 ? "24" : "30"}`,
    targetSets: 4,
    targetReps: 8,
    weight: 100,
    previousWeight: 100,
    reps,
  };
}

const entries = [entry(1, [8, 8, 8, 7]), entry(2, [8, 8, 8, 8])];
const weekOne = buildWeeklyExerciseComparisonModel({
  plannedExercises: [plannedExercise], entries, selectedDay: "Martes", selectedWeek: 1, currentWeek: 2,
});
const weekOneResults = renderToStaticMarkup(<WeeklyResultsPanel model={weekOne} />);
const weekOneReps = renderToStaticMarkup(<WeeklyMetricSummaryView summary={weekOne.repsSummary} model={weekOne} metric="reps" />);

assert.match(weekOneResults, /Rutina planificada/);
assert.match(weekOneResults, /Semana 1/);
assert.match(weekOneResults, /Realizaste 4 de 4 series y 31 de 32 repeticiones planificadas/);
assert.doesNotMatch(weekOneResults, /Esta es tu primera referencia registrada/);
assert.match(weekOneReps, /32 repeticiones/);
assert.match(weekOneReps, /31 repeticiones/);
assert.match(weekOneReps, /Te faltó 1 repetición para cumplir lo planificado/);

const weekTwo = buildWeeklyExerciseComparisonModel({
  plannedExercises: [plannedExercise], entries, selectedDay: "Martes", selectedWeek: 2, currentWeek: 2,
});
const weekTwoResults = renderToStaticMarkup(<WeeklyResultsPanel model={weekTwo} />);
assert.match(weekTwoResults, /Primer registro vs semana elegida/);
assert.doesNotMatch(weekTwoResults, /Realizaste 4 de 4 series y 31 de 32/);

console.log("weekly first-week comparison render tests passed");
