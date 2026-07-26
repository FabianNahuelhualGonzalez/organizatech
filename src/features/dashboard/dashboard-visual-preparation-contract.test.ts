import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Dashboard visual preparation contract only.
 *
 * This test does not render React, simulate interactions, execute browser
 * behavior or validate persistence. Behavioral coverage remains in the pure
 * Dashboard, Progress and Training module tests.
 */
const paths = [
  "src/features/dashboard/components/dashboard-screen.tsx",
  "src/features/dashboard/components/dashboard-training-card-content.tsx",
  "src/features/dashboard/components/dashboard-day-dots.tsx",
  "src/features/dashboard/components/weekly-progress-svg.tsx",
  "src/features/dashboard/components/dashboard-coach-card.tsx",
  "src/features/dashboard/components/empty-dashboard.tsx",
  "src/ui/data-display/index-dots.tsx",
  "src/ui/data-display/metric-grid.tsx",
  "src/ui/data-display/trend-value.tsx",
];
const sources = new Map(paths.map((path) => [path, readFileSync(path, "utf8")]));
const preparedSource = [...sources.values()].join("\n");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const globalsSource = readFileSync("src/app/globals.css", "utf8");

// CONTRATO ESTATICO 1: todos los componentes preparados se exportan una vez.
for (const componentName of [
  "DashboardScreen",
  "DashboardTrainingCardContent",
  "DashboardDayDots",
  "WeeklyProgressSvg",
  "DashboardCoachCard",
  "EmptyDashboard",
  "IndexDots",
  "MetricGrid",
  "RoutineMetricGrid",
  "TrendValue",
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

const dashboardScreenSource = sources.get(paths[0]) ?? "";
const trainingCardSource = sources.get(paths[1]) ?? "";
const weeklyProgressSource = sources.get(paths[3]) ?? "";
const coachSource = sources.get(paths[4]) ?? "";

// CONTRATOS ESTATICOS 4 y 5: jerarquia, clases y data-section sensibles se conservan.
for (const className of [
  "screen",
  "card wide dashboard-progress-card",
  "dashboard-training-carousel",
  "dashboard-training-slide",
  "dashboard-training-card-content",
  "dashboard-exercise-table-row",
  "weekly-progress-visual",
  "dashboard-coach-card",
  "metric-grid wide dashboard-metric-grid",
]) {
  assert.match(preparedSource, new RegExp(className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
for (const sectionName of ["weekly-progress", "training-carousel", "coach"]) {
  assert.match(dashboardScreenSource, new RegExp(`data-section="${sectionName}"`));
}
assert.match(trainingCardSource, /role="table"/);
assert.match(weeklyProgressSource, /<svg viewBox=\{`0 0 480 \$\{chartViewBoxHeight\}`\}/);
assert.match(coachSource, /className="coach-insight-grid"/);

// CONTRATO ESTATICO 6: el contrato principal conserva las props productivas.
for (const propName of [
  "exercises",
  "hasTrainingEntries",
  "hasRoutinePlan",
  "usesCycleScopedSessions",
  "day",
  "weekDays",
  "dayExercises",
  "summary",
  "weeklyEquivalentProgress",
  "currentWeek",
  "entries",
  "sessions",
  "startRegistration",
  "goToRoutine",
  "viewSummary",
  "switchDay",
]) {
  assert.match(dashboardScreenSource, new RegExp(`\\b${propName}:`));
}

// Hooks visuales y geometria DOM permanecen dentro del componente preparado.
assert.match(dashboardScreenSource, /useRef<HTMLDivElement \| null>/);
assert.match(dashboardScreenSource, /useEffect\(\(\) => \{/);
assert.match(dashboardScreenSource, /container\.scrollTo\(/);
assert.match(dashboardScreenSource, /container\.scrollLeft/);
assert.match(dashboardScreenSource, /onScroll=\{handleTrainingCarouselScroll\}/);

// CONTRATOS ESTATICOS 7 y 8: los originales siguen presentes durante preparacion.
for (const originalName of [
  "DashboardScreen",
  "DashboardTrainingCardContent",
  "DashboardDayDots",
  "WeeklyProgressSvg",
  "DashboardCoachCard",
  "IndexDots",
  "MetricGrid",
  "RoutineMetricGrid",
  "TrendValue",
]) {
  assert.match(appSource, new RegExp(`function ${originalName}\\b`));
}

// CONTRATOS ESTATICOS 9 y 10: tests no registrados y CSS activo disponible.
assert.equal(packageSource.includes("dashboard-visual-preparation-contract.test.ts"), false);
for (const selector of [
  ".screen > *",
  ".dashboard-training-carousel",
  ".dashboard-training-slide",
  ".dashboard-coach-card",
  ".weekly-progress-visual",
]) {
  assert.ok(globalsSource.includes(selector), `globals.css conserva ${selector}`);
}

console.log("dashboard visual preparation static contract tests passed");
