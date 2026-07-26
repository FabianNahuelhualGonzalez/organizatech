import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Progress visual preparation contract only.
 *
 * This test does not render React, simulate interactions, execute browser
 * behavior or validate persistence. Runtime behavior remains covered by the
 * pure weekly comparison and chart tests.
 */
const paths = [
  "src/features/progress/components/comparison-screen-v2.tsx",
  "src/features/progress/components/weekly-results-panel.tsx",
  "src/features/progress/components/weekly-series-column.tsx",
  "src/features/progress/components/weekly-metric-progress-card.tsx",
  "src/features/progress/components/weekly-metric-summary-view.tsx",
  "src/features/progress/weekly-comparison-date.ts",
];
const sources = new Map(paths.map((path) => [path, readFileSync(path, "utf8")]));
const preparedSource = [...sources.values()].join("\n");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const globalsSource = readFileSync("src/app/globals.css", "utf8");

// CONTRATO ESTATICO 1: cada componente preparado tiene un unico export.
for (const componentName of [
  "ComparisonScreenV2",
  "WeeklyResultsPanel",
  "WeeklySeriesColumn",
  "WeeklyMetricProgressCard",
  "WeeklyMetricSummaryView",
]) {
  assert.equal(
    (preparedSource.match(new RegExp(`export function ${componentName}\\b`, "g")) ?? []).length,
    1,
    `${componentName} tiene una unica preparacion exportada`,
  );
}

// CONTRATOS ESTATICOS 2 y 3: no existe dependencia inversa ni acceso a infraestructura.
for (const forbiddenImport of [
  "@/components/organizatech-app",
  "@/lib/storage/",
  "@/lib/supabase/",
  "@/lib/data/repository",
  "repository",
  "process.env",
]) {
  assert.doesNotMatch(preparedSource, new RegExp(forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const comparisonSource = sources.get(paths[0]) ?? "";
const resultsSource = sources.get(paths[1]) ?? "";
const metricCardSource = sources.get(paths[3]) ?? "";
const metricSummarySource = sources.get(paths[4]) ?? "";

// CONTRATOS ESTATICOS 4 y 5: clases, data-section y estructura posicional se preservan.
assert.match(comparisonSource, /className="screen weekly-comparison-screen" data-section="weekly-comparison"/);
for (const className of [
  "weekly-comparison-shell",
  "weekly-comparison-section select-day-section",
  "weekly-plan-row heading",
  "weekly-results-heading",
  "weekly-results-grid",
  "weekly-series-column",
  "weekly-metric-summary",
  "weekly-metric-divider",
]) {
  assert.match(preparedSource, new RegExp(className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(resultsSource, /<WeeklySeriesColumn title=\{`Semana \$\{baseline\.week\}`\}/);
assert.match(metricCardSource, /<ResponsiveContainer width="100%" height=\{210\}>/);
assert.match(metricSummarySource, /metric === "reps" \? "reps-summary" : "kg-summary"/);

// CONTRATO ESTATICO 6: el contrato principal conserva todas las props actuales.
for (const propName of [
  "exercises",
  "metrics",
  "currentWeek",
  "routineDays",
  "selectedDay",
  "setSelectedDay",
]) {
  assert.match(comparisonSource, new RegExp(`\\b${propName}:`));
}

// Hooks locales y seleccion siguen en el componente preparado.
assert.match(comparisonSource, /useState\(""\)/);
assert.match(comparisonSource, /useState<number \| null>\(null\)/);
assert.match(comparisonSource, /useMemo\(\(\) => buildWeeklyExerciseComparisonModel\(/);
assert.equal((comparisonSource.match(/useEffect\(/g) ?? []).length, 2);

// CONTRATOS ESTATICOS 7 y 8: originales conservados; no hay registro prematuro.
for (const originalName of [
  "ComparisonScreenV2",
  "WeeklyResultsPanel",
  "WeeklySeriesColumn",
  "WeeklyMetricProgressCard",
  "WeeklyMetricSummaryView",
]) {
  assert.match(appSource, new RegExp(`function ${originalName}\\b`));
}
assert.equal(packageSource.includes("progress-visual-preparation-contract.test.ts"), false);

// CONTRATOS ESTATICOS 9 y 10: selectores estructurales activos siguen disponibles.
for (const selector of [
  ".screen > *",
  ".weekly-comparison-shell",
  ".weekly-comparison-section",
  ".weekly-results-grid::before",
  ".weekly-metric-summary > div:not(.weekly-metric-divider)",
]) {
  assert.ok(globalsSource.includes(selector), `globals.css conserva ${selector}`);
}

console.log("progress visual preparation static contract tests passed");
