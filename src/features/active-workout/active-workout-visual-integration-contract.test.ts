import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula sliders,
 * clicks ni navegador, y no prueba persistencia.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource("package.json");
const files = {
  readiness: readSource("src/features/active-workout/components/TrainingReadinessScreen.tsx"),
  start: readSource("src/features/active-workout/components/TrainingStartScreen.tsx"),
  completion: readSource("src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx"),
  performancePanel: readSource("src/features/active-workout/components/ExerciseLastPerformancePanel.tsx"),
  seriesResult: readSource("src/features/active-workout/components/SeriesResult.tsx"),
  guided: readSource("src/features/active-workout/components/GuidedTrainingScreen.tsx"),
};

function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: no debe importar el root`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: no debe importar storage`);
    assert.doesNotMatch(path, /supabase/i, `${label}: no debe importar Supabase`);
    assert.doesNotMatch(path, /-repository$/, `${label}: no debe importar repositories`);
  });
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
}

// Cada componente se verifica contra su consumidor REAL: importado alli, renderizado alli, y
// nunca declarado inline en el root. Tras P3-30, ExerciseLastPerformancePanel y SeriesResult ya
// no los consume el root sino GuidedTrainingScreen, que absorbio ese JSX en la extraccion.
const components = [
  ["TrainingReadinessScreen", "@/features/active-workout/components/TrainingReadinessScreen", appSource],
  ["TrainingStartScreen", "@/features/active-workout/components/TrainingStartScreen", appSource],
  ["TrainingCompletionSummaryScreen", "@/features/active-workout/components/TrainingCompletionSummaryScreen", appSource],
  ["GuidedTrainingScreen", "@/features/active-workout/components/GuidedTrainingScreen", appSource],
  ["ExerciseLastPerformancePanel", "@/features/active-workout/components/ExerciseLastPerformancePanel", files.guided],
  ["SeriesResult", "@/features/active-workout/components/SeriesResult", files.guided],
] as const;
for (const [componentName, modulePath, consumerSource] of components) {
  assert.match(consumerSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(consumerSource, new RegExp(`<${componentName}\\b`));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));
assert.match(files.readiness, /onSubmit: \(value: Omit<TrainingReadiness, "skipped">\)/);
assert.match(files.readiness, /className="readiness-slider"/);
assert.match(files.start, /routineDays: string\[\];/);
assert.match(files.start, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.doesNotMatch(files.start, /^\s*function RoutineMetricGrid\b/m);
assert.match(files.completion, /className="training-completion-table" role="table"/);
assert.match(files.performancePanel, /className="exercise-observation-textarea"/);
assert.match(files.seriesResult, /className={`series-result session-summary \$\{result\.tone\}`}/);

// GuidedTrainingScreen (P3-30): extraccion mecanica. Conserva el contrato de props, reutiliza el
// normalizador canonico de P3-29 sin redeclararlo, y no introduce estado ni efectos propios.
assert.match(files.guided, /export interface GuidedTrainingScreenProps \{/);
assert.match(files.guided, /className="card wide mobile-series-card"/);
assert.match(files.guided, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.doesNotMatch(files.guided, /^\s*function RoutineMetricGrid\b/m);
assert.match(
  files.guided,
  /import \{ normalizeExerciseDraft, type ExerciseDraft \} from "@\/lib\/training\/training-exercise-draft";/,
);
assert.doesNotMatch(files.guided, /function normalizeExerciseDrafts?\(/, "no debe duplicar los normalizadores canonicos de P3-29");
for (const forbiddenHook of [/\buseState\b/, /\buseEffect\b/, /\buseReducer\b/, /\buseRef\b/]) {
  assert.doesNotMatch(files.guided, forbiddenHook, "GuidedTrainingScreen debe permanecer sin estado ni efectos propios");
}
for (const prop of [
  "day", "routine", "exercises", "targetSummary", "activeIndex", "setActiveIndex", "drafts",
  "updateDraft", "registerExercise", "saveCompletedTraining", "editRoutine", "routineDays",
  "switchDay", "notice", "isBusy",
]) {
  assert.match(files.guided, new RegExp(`^\\s{2}${prop}[?]?:`, "m"), `GuidedTrainingScreenProps debe declarar ${prop}`);
}

const registration = "tsx src/features/active-workout/active-workout-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("active-workout visual static integration contract tests passed");
