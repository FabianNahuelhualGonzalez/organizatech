import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Dashboard integration source contract only.
 *
 * This file does not render React, simulate carousel interaction or execute
 * runtime effects. Behavioral coverage belongs to the pure Dashboard module
 * tests; these assertions only guard delegation and integration boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageStaticSource = readFileSync("package.json", "utf8");

function extractStaticSourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio del contrato estatico: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final del contrato estatico: ${endMarker}`);
  return source.slice(start, end);
}

const dashboardScreenStaticSource = extractStaticSourceSection(
  appStaticSource,
  "function DashboardScreen(",
  "function DashboardTrainingCardContent(",
);
const dashboardCardStaticSource = extractStaticSourceSection(
  appStaticSource,
  "function DashboardTrainingCardContent(",
  "function TrainingCompletionSummaryScreen(",
);
const dashboardCoachStaticSource = extractStaticSourceSection(
  appStaticSource,
  "function DashboardCoachCard(",
  "function NotificationGroup(",
);

// CONTRATO ESTATICO 1: React importa y usa los modulos puros Dashboard.
for (const modulePath of [
  "@/lib/dashboard/dashboard-card-model",
  "@/lib/dashboard/dashboard-card-selector",
  "@/lib/dashboard/dashboard-carousel-state",
  "@/lib/dashboard/dashboard-presentation",
  "@/lib/dashboard/dashboard-types",
]) {
  assert.match(appStaticSource, new RegExp(`from "${modulePath}"`));
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
  assert.match(appStaticSource, new RegExp(`${helperName}\\(`));
}

// CONTRATOS ESTATICOS 2 y 9: no quedan implementaciones locales duplicadas.
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
  assert.doesNotMatch(appStaticSource, new RegExp(`^\\s*function\\s+${removedLocalHelper}\\b`, "m"));
}
assert.doesNotMatch(appStaticSource, /interface\s+(?:DashboardTrainingCardData|AnalyticsSnapshot)\b/);

// CONTRATO ESTATICO 3: el adaptador que combina datos productivos permanece en React.
const dayDataStaticSource = extractStaticSourceSection(
  dashboardScreenStaticSource,
  "  function getDashboardDayData(",
  "  const activeDayData",
);
assert.match(dayDataStaticSource, /findDashboardSessionForDay\(/);
assert.match(dayDataStaticSource, /findDashboardEntries\(/);
assert.match(dayDataStaticSource, /getCycleScopedDayCoverage\(/);
assert.match(dayDataStaticSource, /calculateWeeklyComparison\(/);

// CONTRATO ESTATICO 4: refs, scroll, medicion DOM, hooks y efectos siguen en React.
assert.match(dashboardScreenStaticSource, /useRef<HTMLDivElement \| null>/);
assert.match(dashboardScreenStaticSource, /useState\(day\)/);
assert.match(dashboardScreenStaticSource, /useEffect\(\(\) => \{/);
assert.match(dashboardScreenStaticSource, /container\.scrollTo\(/);
assert.match(dashboardScreenStaticSource, /container\.scrollLeft/);
assert.match(dashboardScreenStaticSource, /container\.clientWidth/);
assert.match(dashboardScreenStaticSource, /child\.offsetLeft/);
assert.match(dashboardScreenStaticSource, /child\.offsetWidth/);
assert.match(dashboardScreenStaticSource, /onScroll=\{handleTrainingCarouselScroll\}/);

// CONTRATO ESTATICO 5: no se inventa navegacion next/previous ni estado de indice.
assert.doesNotMatch(dashboardScreenStaticSource, /\b(?:nextDashboardDay|previousDashboardDay|goToNextDay|goToPreviousDay)\b/);
assert.doesNotMatch(dashboardScreenStaticSource, /useState\([^\n]*(?:carouselIndex|activeIndex)/);
assert.match(dashboardScreenStaticSource, /resolveActiveCarouselIndex\(/);

// CONTRATO ESTATICO 6: cada boton consume su flag independiente.
assert.match(dashboardScreenStaticSource, /cardVisibility\.showEmptyRoutineAction\s*\?/);
assert.match(dashboardScreenStaticSource, /cardVisibility\.showTrainingCardAction\s*\?/);
assert.doesNotMatch(dashboardScreenStaticSource, /showDashboardAction/);

// CONTRATO ESTATICO 7: hasRoutine e isCompleted salen y se consumen directamente.
assert.match(dayDataStaticSource, /hasRoutine:\s*itemExercises\.length > 0 \|\| isCompleted/);
assert.match(dayDataStaticSource, /\bisCompleted,\s*\n/);
assert.match(dashboardScreenStaticSource, /activeDayHasRoutine:\s*activeDayData\.hasRoutine/);
assert.match(dashboardScreenStaticSource, /itemData\.hasRoutine\s*\?/);

// CONTRATO ESTATICO 8: Coach delega analytics, vacio y presentacion visual.
assert.match(dashboardScreenStaticSource, /buildDashboardCoachAnalytics\(/);
assert.match(dashboardScreenStaticSource, /resolveIsCurrentWeekEmptyCoach\(/);
assert.match(dashboardScreenStaticSource, /buildEmptyCurrentWeekCoachFeedback\(/);
assert.match(dashboardScreenStaticSource, /resolveDashboardCoachVisualStatus\(/);
assert.match(dashboardCoachStaticSource, /resolveDashboardCoachFactorLabel\(/);
assert.match(dashboardCoachStaticSource, /clampDashboardCoachFactorValue\(/);

// Presentacion derivada se delega sin cambiar la estructura visible del card.
assert.match(dashboardCardStaticSource, /buildDashboardCarouselTableAriaLabel\(model\.day\)/);
assert.match(dashboardCardStaticSource, /buildDashboardOverflowLabel\(model\.additionalExerciseCount\)/);
assert.match(dashboardCardStaticSource, /resolveDashboardDotIndex\(weekDays, day\)/);
assert.match(dashboardCardStaticSource, /DASHBOARD_DOTS_ARIA_LABEL/);

const testRegistration = "tsx src/lib/dashboard/dashboard-integration-contract.test.ts";
assert.equal(packageStaticSource.split(testRegistration).length - 1, 1);

console.log("dashboard static integration source contract tests passed");
