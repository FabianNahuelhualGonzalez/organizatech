import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import {
  buildExerciseLastPerformancePresentation,
  formatLocalTrainingDate,
} from "@/lib/training/exercise-last-performance-presentation";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";

const basePerformance: LatestExercisePerformance = {
  sessionId: "session-1",
  exerciseLineageId: "lineage-1",
  trainedDate: "2026-06-12",
  trainedAt: "2026-06-12T23:30:00.000Z",
  completedAt: "2026-06-12T23:45:00.000Z",
  createdAt: "2026-06-12T23:00:00.000Z",
  series: [
    createSeries({ order: 1, reps: 10, weight: 95, rir: "2" }),
    createSeries({ order: 2, reps: 10, weight: 95 }),
    createSeries({ order: 3, reps: 9, weight: 95, rir: "0" }),
  ],
};

const planned = { targetSets: 3, targetReps: 10, baseWeight: 100 };
const historicalGoalText = "Iguala o supera por 1 repetición vs la semana pasada";

{
  const view = buildExerciseLastPerformancePresentation({ planned, latest: basePerformance });
  assert.equal(view.objectiveText, "3 × 10 · 100 kg");
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.lastHeaderText, "DETALLE DE SERIES · 12 JUN");
  assert.equal(view.seriesDetailTitle, "Ver detalle de series · 12 JUN");
  assert.equal(view.lastSummaryText, "95 kg · 10 / 10 / 9 reps");
  assert.equal(view.comparisonText, "+5 kg · +1 rep");
  assert.equal(view.comparisonTone, "positive");
  assert.deepEqual(view.seriesRows, [
    { label: "Serie 1", value: "95 kg · 10 repeticiones · RIR 2" },
    { label: "Serie 2", value: "95 kg · 10 repeticiones" },
    { label: "Serie 3", value: "95 kg · 9 repeticiones · RIR 0" },
  ]);
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: 3, targetReps: 10, baseWeight: null },
    latest: basePerformance,
  });
  assert.equal(view.objectiveText, "3 × 10");
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.comparisonText, "+1 rep");
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: 3, targetReps: "8-10", baseWeight: 100 },
    latest: basePerformance,
  });
  assert.equal(view.objectiveText, "3 × 8-10 · 100 kg");
  assert.equal(view.todayGoalText, historicalGoalText);
}

assert.equal(formatLocalTrainingDate("2026-06-12"), "12 JUN");
assert.equal(formatLocalTrainingDate("2026-06-12T23:30:00.000Z"), "12 JUN");

{
  const view = buildExerciseLastPerformancePresentation({
    planned,
    latest: {
      ...basePerformance,
      series: [
        createSeries({ order: 1, reps: 8, weight: 80 }),
        createSeries({ order: 2, reps: 8, weight: 90 }),
        createSeries({ order: 3, reps: 8, weight: 95 }),
      ],
    },
  });
  assert.equal(view.lastSummaryText, "80-95 kg · 8 / 8 / 8 reps");
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.comparisonText, "+5 kg · +6 reps");
  assert.deepEqual(view.seriesRows, [
    { label: "Serie 1", value: "80 kg · 8 repeticiones" },
    { label: "Serie 2", value: "90 kg · 8 repeticiones" },
    { label: "Serie 3", value: "95 kg · 8 repeticiones" },
  ]);
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned,
    latest: {
      ...basePerformance,
      series: [
        createSeries({ order: 1, reps: 10, weight: null, previousWeight: 200 }),
        createSeries({ order: 2, reps: 10, weight: null, previousWeight: 200 }),
      ],
    },
  });
  assert.equal(view.lastSummaryText, "10 / 10 reps");
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.comparisonText, "+10 reps");
  assert(!view.lastSummaryText.includes("200 kg"));
  assert(!JSON.stringify(view.seriesRows).includes("200 kg"));
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: 3, targetReps: 10, baseWeight: 90 },
    latest: {
      ...basePerformance,
      series: [
        createSeries({ order: 1, reps: 11, weight: 95 }),
        createSeries({ order: 2, reps: 11, weight: 95 }),
        createSeries({ order: 3, reps: 11, weight: 95 }),
      ],
    },
  });
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.comparisonText, "-5 kg · -3 reps");
  assert.equal(view.comparisonTone, "negative");
}

{
  const view = buildExerciseLastPerformancePresentation({ planned, latest: {
    ...basePerformance,
    series: [
      createSeries({ order: 1, reps: 10, weight: 100 }),
      createSeries({ order: 2, reps: 10, weight: 100 }),
      createSeries({ order: 3, reps: 10, weight: 100 }),
    ],
  } });
  assert.equal(view.todayGoalText, historicalGoalText);
  assert.equal(view.comparisonText, "Mismo peso · Mismas reps");
  assert.equal(view.comparisonTone, "neutral");
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: null, targetReps: null, baseWeight: 100 },
    latest: basePerformance,
  });
  assert.equal(view.comparisonText, "+5 kg");
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: 3, targetReps: 10, baseWeight: null },
    latest: basePerformance,
  });
  assert.equal(view.comparisonText, "+1 rep");
}

{
  const view = buildExerciseLastPerformancePresentation({ planned, latest: null });
  assert.equal(view.status, "empty");
  assert.equal(view.lastSummaryText, "Sin registros anteriores");
  assert.equal(view.seriesDetailTitle, "Sin registros anteriores");
  assert.equal(view.todayGoalText, "Tu primera referencia se guardará al finalizar");
  assert.equal(view.comparisonText, "Tu primera referencia se guardará al finalizar");
}

{
  const view = buildExerciseLastPerformancePresentation({ planned, latest: null, error: "boom" });
  assert.equal(view.status, "error");
  assert.equal(view.lastSummaryText, "Historial no disponible");
  assert.equal(view.seriesDetailTitle, "Detalle de series no disponible");
  assert.equal(view.todayGoalText, "Completa tu objetivo de hoy; revisaremos la referencia luego");
  assert.equal(view.comparisonText, "Comparación no disponible");
}

{
  const view = buildExerciseLastPerformancePresentation({ planned, latest: null, loading: true });
  assert.equal(view.status, "loading");
  assert.equal(view.lastSummaryText, "Cargando referencia");
}

{
  const view = buildExerciseLastPerformancePresentation({
    planned: { targetSets: null, targetReps: null, baseWeight: null },
    latest: {
      ...basePerformance,
      series: [createSeries({ order: 1, reps: null, weight: null })],
    },
  });
  assert.equal(view.comparisonText, "Aún no hay datos comparables");
  assert(!JSON.stringify(view).includes("null kg"));
  assert(!JSON.stringify(view).includes("undefined reps"));
  assert(!JSON.stringify(view).includes("NaN"));
}

{
  const multiEntry = buildExerciseLastPerformancePresentation({
    planned: { targetSets: 4, targetReps: 10, baseWeight: 50 },
    latest: {
      ...basePerformance,
      series: [
        createSeries({ entryId: "entry-a", order: 1, reps: 10, weight: 50 }),
        createSeries({ entryId: "entry-a", order: 2, reps: 10, weight: 50 }),
        createSeries({ entryId: "entry-b", order: 3, reps: 9, weight: 50 }),
        createSeries({ entryId: "entry-b", order: 4, reps: 8, weight: 50 }),
      ],
    },
  });
  assert.equal(multiEntry.lastSummaryText, "50 kg · 10 / 10 / 9 / 8 reps");
  assert.equal(multiEntry.seriesRows[0]?.value, "50 kg · 10 repeticiones");
  assert.equal(multiEntry.seriesRows.length, 4);
}

const source = readFileSync(new URL("./exercise-last-performance-presentation.ts", import.meta.url), "utf8");
assert(!source.includes("exercise_id"));
assert(!source.includes("exerciseId"));
assert(!source.includes("previousWeight") || source.includes("previousWeight?:"));

console.log("exercise-last-performance-presentation tests passed");

function createSeries(input: {
  entryId?: string;
  order: number;
  weight: number | null;
  previousWeight?: number | null;
  reps: number | null;
  rir?: string | null;
}) {
  return {
    entryId: input.entryId ?? `entry-${input.order}`,
    order: input.order,
    weight: input.weight,
    previousWeight: input.previousWeight ?? null,
    reps: input.reps,
    rir: input.rir ?? null,
    notes: null,
    createdAt: `2026-06-12T12:0${input.order}:00.000Z`,
  };
}
