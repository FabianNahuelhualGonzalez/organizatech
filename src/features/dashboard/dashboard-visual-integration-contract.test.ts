import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Dashboard visual integration contract only.
 *
 * This test does not render React, simulate carousel interactions or execute
 * browser behavior. Unit tests under src/lib cover behavioral decisions.
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
const featureSource = [...sources.values()].join("\n");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const sessionSelectionSource = readFileSync("src/lib/dashboard/dashboard-session-selection.ts", "utf8");
const santiagoCalendarSource = readFileSync("src/lib/dashboard/dashboard-santiago-calendar.ts", "utf8");
const santiagoTrainingDateSource = readFileSync("src/lib/training/santiago-training-date.ts", "utf8");
const exerciseNameNormalizationSource = readFileSync("src/lib/training/exercise-name-normalization.ts", "utf8");
const weeklyEquivalentProgressSource = readFileSync("src/lib/progress/weekly-equivalent-progress.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");

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
    (featureSource.match(new RegExp(`export function ${componentName}\\b`, "g")) ?? []).length,
    1,
    `${componentName} tiene una sola definición productiva exportada`,
  );
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const forbiddenImport of [
  "@/components/organizatech-app",
  "@/lib/storage/",
  "@/lib/supabase/",
  "@/lib/data/repository",
  "process.env",
]) {
  assert.doesNotMatch(featureSource, new RegExp(forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(appSource, /import \{ DashboardScreen \} from "@\/features\/dashboard\/components\/dashboard-screen";/);
assert.match(appSource, /import \{ EmptyDashboard \} from "@\/features\/dashboard\/components\/empty-dashboard";/);
assert.match(appSource, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.match(appSource, /<DashboardScreen[\s\S]*?weekDays=\{dashboardCarouselDays\}/);
assert.doesNotMatch(appSource, /weekDays=\{\[\.\.\.dashboardCarouselDays\]\}/);

const dashboardSource = sources.get(paths[0]) ?? "";
assert.match(dashboardSource, /weekDays: readonly string\[\];/);
for (const propName of [
  "exercises",
  "hasTrainingEntries",
  "hasRoutinePlan",
  "usesCycleScopedSessions",
  "day",
  "weekDays",
  "summary",
  "weeklyEquivalentProgress",
  "startRegistration",
  "goToRoutine",
  "viewSummary",
  "switchDay",
]) {
  assert.match(dashboardSource, new RegExp(`\\b${propName}:`));
}
for (const sectionName of ["weekly-progress", "training-carousel", "coach"]) {
  assert.match(dashboardSource, new RegExp(`data-section="${sectionName}"`));
}
assert.match(dashboardSource, /useRef<HTMLDivElement \| null>/);
assert.match(dashboardSource, /container\.scrollTo\(/);
assert.match(dashboardSource, /onScroll=\{handleTrainingCarouselScroll\}/);
for (const consumerSource of [appSource, dashboardSource]) {
  assert.match(consumerSource, /from "@\/lib\/dashboard\/dashboard-santiago-calendar";/);
  assert.match(consumerSource, /from "@\/lib\/dashboard\/dashboard-session-selection";/);
}
assert.match(appSource, /from "@\/lib\/training\/exercise-name-normalization";/);
assert.match(appSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.match(dashboardSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.match(sessionSelectionSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.match(santiagoCalendarSource, /from "@\/lib\/training\/exercise-name-normalization";/);
assert.match(santiagoCalendarSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.match(weeklyEquivalentProgressSource, /from "@\/lib\/training\/exercise-name-normalization";/);
assert.match(weeklyEquivalentProgressSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.doesNotMatch(weeklyEquivalentProgressSource, /from "@\/lib\/dashboard\//);

const canonicalHelperSources = [
  sessionSelectionSource,
  santiagoCalendarSource,
  santiagoTrainingDateSource,
  exerciseNameNormalizationSource,
  weeklyEquivalentProgressSource,
].join("\n");
for (const helperName of [
  "findDashboardSessionForDay",
  "findDashboardEntries",
  "getDashboardExerciseIdentity",
  "getDashboardEntryExerciseIdentity",
  "normalizeEntryDateKey",
  "getCurrentSantiagoWeekDates",
  "getSantiagoDateKey",
  "getTrainingDayFromDate",
  "getLocalDateKey",
  "getTrainingDayCode",
  "removeAccents",
]) {
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
  assert.doesNotMatch(dashboardSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
  assert.equal(
    (canonicalHelperSources.match(new RegExp(`^(?:export\\s+)?function ${helperName}\\b`, "gm")) ?? []).length,
    1,
  );
}

const neutralCanonicalSources = [santiagoTrainingDateSource, exerciseNameNormalizationSource].join("\n");
assert.doesNotMatch(neutralCanonicalSources, /from "@\/(?:features|lib\/(?:dashboard|progress))\//);

const trainingStartSource = readFileSync("src/features/active-workout/components/TrainingStartScreen.tsx", "utf8");
assert.match(trainingStartSource, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.doesNotMatch(trainingStartSource, /^\s*function RoutineMetricGrid\b/m);

const registration = "tsx src/features/dashboard/dashboard-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("dashboard visual static integration contract tests passed");
