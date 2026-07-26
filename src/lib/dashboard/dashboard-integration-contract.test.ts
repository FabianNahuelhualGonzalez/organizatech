import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Dashboard domain-to-visual integration source contract only.
 *
 * This file does not render React, simulate carousel interaction or execute
 * runtime effects. Behavioral coverage belongs to the pure Dashboard tests.
 */
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const dashboardSource = readFileSync("src/features/dashboard/components/dashboard-screen.tsx", "utf8");
const cardSource = readFileSync("src/features/dashboard/components/dashboard-training-card-content.tsx", "utf8");
const dayDotsSource = readFileSync("src/features/dashboard/components/dashboard-day-dots.tsx", "utf8");
const coachSource = readFileSync("src/features/dashboard/components/dashboard-coach-card.tsx", "utf8");
const sessionSelectionSource = readFileSync("src/lib/dashboard/dashboard-session-selection.ts", "utf8");
const santiagoCalendarSource = readFileSync("src/lib/dashboard/dashboard-santiago-calendar.ts", "utf8");
const santiagoTrainingDateSource = readFileSync("src/lib/training/santiago-training-date.ts", "utf8");
const exerciseNameNormalizationSource = readFileSync("src/lib/training/exercise-name-normalization.ts", "utf8");
const weeklyEquivalentProgressSource = readFileSync("src/lib/progress/weekly-equivalent-progress.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const integratedSource = [
  appSource,
  dashboardSource,
  cardSource,
  dayDotsSource,
  coachSource,
  sessionSelectionSource,
  santiagoCalendarSource,
  santiagoTrainingDateSource,
  exerciseNameNormalizationSource,
].join("\n");

assert.match(appSource, /import \{ DashboardScreen \} from "@\/features\/dashboard\/components\/dashboard-screen";/);
assert.match(appSource, /<DashboardScreen\b/);
assert.doesNotMatch(appSource, /^\s*function DashboardScreen\b/m);

for (const modulePath of [
  "@/lib/dashboard/dashboard-card-model",
  "@/lib/dashboard/dashboard-card-selector",
  "@/lib/dashboard/dashboard-carousel-state",
  "@/lib/dashboard/dashboard-presentation",
  "@/lib/dashboard/dashboard-santiago-calendar",
  "@/lib/dashboard/dashboard-session-selection",
  "@/lib/dashboard/dashboard-types",
  "@/lib/training/exercise-name-normalization",
  "@/lib/training/santiago-training-date",
]) {
  assert.match(integratedSource, new RegExp(`from "${modulePath}"`));
}
for (const helperName of [
  "resolveDashboardActiveDay",
  "resolveDashboardCardVisibility",
  "resolveDashboardCarouselDays",
  "resolveDashboardDotIndex",
  "buildDashboardTrainingCardModel",
  "buildDashboardCoachAnalytics",
  "resolveIsCurrentWeekEmptyCoach",
  "resolveDashboardCoachVisualStatus",
]) {
  assert.match(integratedSource, new RegExp(`${helperName}\\(`));
}

for (const removedLocalHelper of [
  "buildDashboardTrainingCardModel",
  "buildAnalytics",
  "clampScore",
  "getCoachFactorLabel",
  "buildWeeklyProgressAriaLabel",
  "buildWeeklyProgressTrendLabel",
  "feedbackHeadlineForStatus",
  "buildEmptyCurrentWeekCoachFeedback",
]) {
  assert.doesNotMatch(integratedSource, new RegExp(`^\\s*function\\s+${removedLocalHelper}\\b`, "m"));
}

assert.match(dashboardSource, /function getDashboardDayData\(/);
assert.match(dashboardSource, /findDashboardSessionForDay\(/);
assert.match(dashboardSource, /findDashboardEntries\(/);
assert.match(dashboardSource, /getCycleScopedDayCoverage\(/);
assert.match(dashboardSource, /calculateWeeklyComparison\(/);
assert.match(dashboardSource, /useRef<HTMLDivElement \| null>/);
assert.match(dashboardSource, /useState\(day\)/);
assert.match(dashboardSource, /useEffect\(\(\) => \{/);
assert.match(dashboardSource, /container\.scrollTo\(/);
assert.match(dashboardSource, /container\.scrollLeft/);
assert.match(dashboardSource, /container\.clientWidth/);
assert.match(dashboardSource, /onScroll=\{handleTrainingCarouselScroll\}/);
assert.doesNotMatch(dashboardSource, /\b(?:nextDashboardDay|previousDashboardDay|goToNextDay|goToPreviousDay)\b/);

assert.match(dashboardSource, /cardVisibility\.showEmptyRoutineAction\s*\?/);
assert.match(dashboardSource, /cardVisibility\.showTrainingCardAction\s*\?/);
assert.match(dashboardSource, /hasRoutine:\s*itemExercises\.length > 0 \|\| isCompleted/);
assert.match(dashboardSource, /activeDayHasRoutine:\s*activeDayData\.hasRoutine/);
assert.match(dashboardSource, /buildDashboardCoachAnalytics\(/);
assert.match(dashboardSource, /resolveDashboardCoachVisualStatus\(/);
assert.match(coachSource, /resolveDashboardCoachFactorLabel\(/);
assert.match(coachSource, /clampDashboardCoachFactorValue\(/);
assert.match(cardSource, /buildDashboardCarouselTableAriaLabel\(model\.day\)/);
assert.match(cardSource, /buildDashboardOverflowLabel\(model\.additionalExerciseCount\)/);
assert.match(dayDotsSource, /resolveDashboardDotIndex\(weekDays, day\)/);

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

const dashboardCanonicalHelpers = [
  "findDashboardSessionForDay",
  "findDashboardEntries",
  "getDashboardExerciseIdentity",
  "getDashboardEntryExerciseIdentity",
  "getCurrentSantiagoWeekDates",
  "getTrainingDayFromDate",
  "getLocalDateKey",
  "getTrainingDayCode",
];
const dashboardCanonicalSources = [sessionSelectionSource, santiagoCalendarSource].join("\n");
for (const helperName of dashboardCanonicalHelpers) {
  assert.equal(
    (dashboardCanonicalSources.match(new RegExp(`export function ${helperName}\\b`, "g")) ?? []).length,
    1,
    `${helperName} debe tener una sola definicion canonica exportada`,
  );
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
  assert.doesNotMatch(dashboardSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
}

const transversalCanonicalHelpers = new Map([
  ["normalizeEntryDateKey", santiagoTrainingDateSource],
  ["getSantiagoDateKey", santiagoTrainingDateSource],
  ["removeAccents", exerciseNameNormalizationSource],
]);
const transversalProductionSources = [
  appSource,
  dashboardSource,
  sessionSelectionSource,
  santiagoCalendarSource,
  weeklyEquivalentProgressSource,
  santiagoTrainingDateSource,
  exerciseNameNormalizationSource,
].join("\n");
for (const [helperName, canonicalSource] of transversalCanonicalHelpers) {
  assert.match(canonicalSource, new RegExp(`export function ${helperName}\\b`));
  assert.equal(
    (transversalProductionSources.match(new RegExp(`^(?:export\\s+)?function ${helperName}\\b`, "gm")) ?? []).length,
    1,
    `${helperName} debe tener una sola declaracion productiva transversal`,
  );
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
  assert.doesNotMatch(dashboardSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
}

const neutralCanonicalSources = [santiagoTrainingDateSource, exerciseNameNormalizationSource].join("\n");
for (const forbiddenImport of ["@/lib/dashboard/", "@/lib/progress/", "@/features/", "react"]) {
  assert.doesNotMatch(neutralCanonicalSources, new RegExp(`from "${forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
}

for (const forbiddenImport of ["@/features/", "@/components/organizatech-app", "react", "@/lib/storage/", "@/lib/data/repository"]) {
  assert.doesNotMatch(dashboardCanonicalSources, new RegExp(`from "${forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
}

const registration = "tsx src/lib/dashboard/dashboard-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);
for (const registrationPath of [
  "tsx src/lib/dashboard/dashboard-santiago-calendar.test.ts",
  "tsx src/lib/dashboard/dashboard-session-selection.test.ts",
  "tsx src/lib/training/santiago-training-date.test.ts",
  "tsx src/lib/training/exercise-name-normalization.test.ts",
]) {
  assert.equal(packageSource.split(registrationPath).length - 1, 1);
}

console.log("dashboard static domain-to-visual integration contract tests passed");
