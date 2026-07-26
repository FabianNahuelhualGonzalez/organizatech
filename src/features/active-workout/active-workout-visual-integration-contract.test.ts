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

const components = [
  ["TrainingReadinessScreen", "@/features/active-workout/components/TrainingReadinessScreen"],
  ["TrainingStartScreen", "@/features/active-workout/components/TrainingStartScreen"],
  ["TrainingCompletionSummaryScreen", "@/features/active-workout/components/TrainingCompletionSummaryScreen"],
  ["ExerciseLastPerformancePanel", "@/features/active-workout/components/ExerciseLastPerformancePanel"],
  ["SeriesResult", "@/features/active-workout/components/SeriesResult"],
] as const;
for (const [componentName, modulePath] of components) {
  assert.match(appSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(appSource, new RegExp(`<${componentName}\\b`));
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

const registration = "tsx src/features/active-workout/active-workout-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("active-workout visual static integration contract tests passed");
