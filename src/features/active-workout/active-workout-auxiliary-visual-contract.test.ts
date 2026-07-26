import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación visual (P3-06). No renderiza React, no simula sliders ni
 * clicks, no prueba el DOM real, no prueba persistencia. Solo inspecciona texto fuente para
 * verificar exports, props, ausencia de dependencias prohibidas, clases relevantes y que las
 * definiciones originales siguen intactas en el root.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");

const files = {
  readiness: readSource("src/features/active-workout/components/TrainingReadinessScreen.tsx"),
  start: readSource("src/features/active-workout/components/TrainingStartScreen.tsx"),
  completion: readSource("src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx"),
  performancePanel: readSource("src/features/active-workout/components/ExerciseLastPerformancePanel.tsx"),
  seriesResult: readSource("src/features/active-workout/components/SeriesResult.tsx"),
};

// Solo inspecciona las rutas literales de los import (no la prosa de los comentarios, que
// legítimamente puede citar "organizatech-app.tsx:NNNN" como referencia de procedencia).
function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: import prohibido de organizatech-app.tsx (${path})`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: import prohibido de storage (${path})`);
    assert.doesNotMatch(path, /supabase/i, `${label}: import prohibido de Supabase (${path})`);
    assert.doesNotMatch(path, /-repository$/, `${label}: import prohibido de repositories (${path})`);
  });
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/, `${label} no debe acceder a window ni document`);
}

// 1-2. Componentes exportados y props principales.
assert.match(files.readiness, /export interface TrainingReadinessScreenProps/);
assert.match(files.readiness, /export function TrainingReadinessScreen\(/);
assert.match(files.readiness, /onSubmit: \(value: Omit<TrainingReadiness, "skipped">\) => void \| Promise<void>;/);
assert.match(files.readiness, /onSkip: \(\) => void \| Promise<void>;/);
assert.match(files.readiness, /isSaving: boolean;/);
assert.match(files.readiness, /error: string;/);

assert.match(files.start, /export interface TrainingStartScreenProps/);
assert.match(files.start, /export function TrainingStartScreen\(/);
assert.match(files.start, /routineDays: string\[\];/);
assert.match(files.start, /switchDay: \(day: string\) => void;/);
assert.match(files.start, /isStartingTraining: boolean;/);

assert.match(files.completion, /export interface TrainingCompletionSummaryScreenProps/);
assert.match(files.completion, /export function TrainingCompletionSummaryScreen\(/);
assert.match(files.completion, /summary: TrainingCompletionSummary;/);
assert.match(files.completion, /onDashboard: \(\) => void;/);

assert.match(files.performancePanel, /export interface ExerciseLastPerformancePanelProps/);
assert.match(files.performancePanel, /export function ExerciseLastPerformancePanel\(/);
assert.match(files.performancePanel, /observationValue: string;/);
assert.match(files.performancePanel, /onObservationChange: \(value: string\) => void;/);

assert.match(files.seriesResult, /export interface SeriesResultProps/);
assert.match(files.seriesResult, /export function SeriesResult\(/);
assert.match(files.seriesResult, /entry: ExerciseMetrics;/);

// 3-4. Ausencia de imports prohibidos.
Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));

// 5. Clases relevantes preservadas (spot-check, no exhaustivo).
assert.match(files.readiness, /className="card wide readiness-card"/);
assert.match(files.readiness, /className="readiness-slider"/);
assert.match(files.readiness, /className="readiness-slider-scale"/);
assert.match(files.start, /className="card wide day-switcher-card"/);
assert.match(files.start, /className="card wide training-start-card"/);
assert.match(files.start, /className={`routine-day-pill configured \$\{item === day \? "active" : ""\}`}/);
assert.match(files.completion, /className="training-completion-screen"/);
assert.match(files.completion, /className="training-completion-table" role="table"/);
assert.match(files.performancePanel, /className="exercise-reference-card"/);
assert.match(files.performancePanel, /className="exercise-observation-textarea"/);
assert.match(files.seriesResult, /className={`series-result session-summary \$\{result\.tone\}`}/);

// Copy/textos preservados literalmente (muestra representativa).
assert.match(files.readiness, /¿Cómo llegas hoy\?/);
assert.match(files.readiness, /Empezar entrenamiento/);
assert.match(files.start, /Iniciar entrenamiento/);
assert.match(files.completion, /Ir al panel principal/);
assert.match(files.performancePanel, /Añadir nuevo comentario/);
assert.match(files.seriesResult, /Resumen de tu sesión/);

// 8. Definiciones originales todavía presentes en el root (no se eliminó nada).
assert.match(appSource, /function TrainingReadinessScreen\(/, "el original debe seguir en el root");
assert.match(appSource, /function TrainingStartScreen\(/, "el original debe seguir en el root");
assert.match(appSource, /function TrainingCompletionSummaryScreen\(/, "el original debe seguir en el root");
assert.match(appSource, /function ExerciseLastPerformancePanel\(/, "el original debe seguir en el root");
assert.match(appSource, /function SeriesResult\(/, "el original debe seguir en el root");

// 9-10. package.json y globals.css sin cambios (verificación de contenido esperado, no de hash;
// el diff real se confirma con git en el control final de la fase).
const packageJson = readSource("package.json");
assert.doesNotMatch(
  packageJson,
  /active-workout-auxiliary-visual-contract\.test\.ts/,
  "este test no debe estar registrado en package.json todavia (se registra en P3-07)",
);
const globalsCss = readSource("src/app/globals.css");
assert.match(globalsCss, /\.readiness-slider\b/, "la clase de la que depende TrainingReadinessScreen debe seguir en globals.css");
assert.match(globalsCss, /\.training-completion-table\b/, "la clase de la que depende TrainingCompletionSummaryScreen debe seguir en globals.css");

console.log("active-workout auxiliary visual contract tests passed");
