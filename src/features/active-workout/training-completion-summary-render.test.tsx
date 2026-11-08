import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildTrainingCompletionSummary,
  type TrainingCompletionHistoricalInput,
  type TrainingCompletionSummary,
} from "@/lib/training/training-completion-summary";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((match) => [match[1], match[1]]));
};
const { TrainingCompletionSummaryScreen } = requireComponent("./components/TrainingCompletionSummaryScreen.tsx") as typeof import("./components/TrainingCompletionSummaryScreen");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

const sample = [
  ["e1", "Sentadilla Smith", 24, 105, 27, 105],
  ["e2", "Hack", 46, 145, 45, 140],
  ["e3", "Ext. de rodilla", 48, 92.2, 48, 92.2],
  ["e4", "Hip thrust", 24, 55, 23, 55],
  ["e5", "Búlgaras Smith", 32, 10, 51, 10],
  ["e6", "Peso muerto rumano", 24, 95, 31, 100],
  ["e7", "Curl femoral", 51, 45, 50, 45],
] as const;

test("renders the approved seven-exercise comparison with accessible symbols and totals", () => {
  const markup = render(summaryWithComparison());
  for (const copy of [
    "ENTRENAMIENTO REGISTRADO",
    "VS. SESIÓN ANTERIOR · 14/10",
    "Mesociclo · Semana 10 · Día 3 de 5",
    "275 → 249",
    "▼ −26",
    "EJERCICIOS · 7",
    "Ir al panel principal",
  ]) assert.ok(markup.includes(copy), `falta ${copy}`);
  assert.match(markup, /▲<\/span> 3/);
  assert.match(markup, /=<\/span> 1/);
  assert.match(markup, /▼<\/span> 3/);
  assert.match(markup, /aria-label="1 repetición más"/);
  assert.match(markup, /aria-label="5 kilos más"/);
  assert.match(markup, /Sentadilla Smith<\/strong><span>3 series/);
  assert.match(markup, /Hack<\/strong><span>4 series/);
  assert.match(markup, /<ul[^>]*>[\s\S]*<li/);
  assert.doesNotMatch(markup, /Ancho|Estado.*Completa|ShareWorkoutCard/);
});

test("renders first-session and incomplete states without treating pending as regression", () => {
  const first = render(summaryWithComparison({ withoutHistory: true }));
  assert.match(first, /PRIMERA SESIÓN DE ESTE DÍA/);
  assert.match(first, /aria-label="Primera vez para este ejercicio"/);
  assert.equal((first.match(/>Primera vez<\/span>/g) ?? []).length, 7);

  const incomplete = render(summaryWithComparison({ pendingFrom: 5 }));
  assert.match(incomplete, /Registrado · 5 de 7/);
  assert.equal((incomplete.match(/Sin registro/g) ?? []).length, 2);
  assert.equal((incomplete.match(/No registrado en esta sesión/g) ?? []).length, 2);
  assert.match(incomplete, /aria-label="Ejercicio sin registro"/);
});

test("uses container queries and the approved responsive breakpoints", () => {
  const css = readFileSync("src/features/active-workout/components/training-completion-summary.module.css", "utf8");
  assert.match(css, /container-name:\s*resumen/);
  assert.match(css, /@container resumen \(min-width: 600px\)/);
  assert.match(css, /@container resumen \(min-width: 1000px\)/);
  assert.match(css, /@container resumen \(min-width: 1280px\)/);
  assert.match(css, /max-width:\s*1200px/);
  assert.match(css, /position:\s*sticky/);
  assert.doesNotMatch(css, /@media/);

  const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const portalCss = readFileSync("src/features/user-portal-shell/components/user-portal-shell.module.css", "utf8");
  assert.equal((root.match(/isContentWide=\{screen === "training-summary"\}/g) ?? []).length, 2);
  assert.match(portalCss, /\.wideShell\s*\{[\s\S]*?width: min\(100%, 1280px\)/);
});

function render(summary: TrainingCompletionSummary) {
  return renderToStaticMarkup(createElement(TrainingCompletionSummaryScreen, {
    summary,
    onDashboard: () => undefined,
  }));
}

function summaryWithComparison(options: { withoutHistory?: boolean; pendingFrom?: number } = {}) {
  const historicalByExerciseId = options.withoutHistory
    ? undefined
    : Object.fromEntries(sample.map(([id, , , , previousReps, previousKg]) => [
      id,
      {
        status: "ready",
        latest: performance(id, splitReps(previousReps, seriesCountForIndex(sample.findIndex((item) => item[0] === id))), previousKg),
      } satisfies TrainingCompletionHistoricalInput,
    ]));

  return buildTrainingCompletionSummary({
    sessionId: "session-current",
    dayLabel: "Miércoles",
    workoutName: "Piernas",
    cycleLabel: "Mesociclo",
    weekLabel: "Semana 10",
    progressLabel: "3 de 5 días",
    workoutStartedAt: "2026-10-21T10:00:00.000Z",
    savedAt: "2026-10-21T12:11:00.000Z",
    currentDate: "2026-10-21",
    exercises: sample.map(([id, name, currentReps, currentKg], index) => ({
      exerciseId: id,
      exerciseLineageId: `${id}-lineage`,
      exerciseName: name,
      targetSets: seriesCountForIndex(index),
      draft: {
        reps: splitReps(currentReps, seriesCountForIndex(index)),
        weight: currentKg,
        registered: options.pendingFrom === undefined || index < options.pendingFrom,
      },
    })),
    historicalByExerciseId,
  });
}

function performance(id: string, reps: number[], weight: number): LatestExercisePerformance {
  return {
    sessionId: "session-previous",
    exerciseLineageId: `${id}-lineage`,
    trainedDate: "2026-10-14",
    trainedAt: "2026-10-14T10:00:00.000Z",
    completedAt: "2026-10-14T11:00:00.000Z",
    createdAt: "2026-10-14T10:00:00.000Z",
    series: reps.map((value, index) => ({
      entryId: `${id}-entry-${index}`,
      order: index + 1,
      weight,
      previousWeight: null,
      reps: value,
      rir: null,
      notes: null,
      createdAt: "2026-10-14T10:00:00.000Z",
    })),
  };
}

function seriesCountForIndex(index: number) {
  return index === 1 || index === 2 ? 4 : 3;
}

function splitReps(total: number, series: number) {
  const base = Math.floor(total / series);
  const remainder = total % series;
  return Array.from({ length: series }, (_, index) => base + (index < remainder ? 1 : 0));
}
