import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Progress helper integration source contract only.
 *
 * This test does not render React, simulate interactions or execute hooks.
 * Runtime behavior is covered by the unit tests for each extracted module.
 */
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const weeklyProgressSource = readFileSync("src/features/dashboard/components/weekly-progress-svg.tsx", "utf8");
const dashboardSource = readFileSync("src/features/dashboard/components/dashboard-screen.tsx", "utf8");
const dashboardCalendarSource = readFileSync("src/lib/dashboard/dashboard-santiago-calendar.ts", "utf8");
const metricSummarySource = readFileSync("src/features/progress/components/weekly-metric-summary-view.tsx", "utf8");
const weeklyEquivalentProgressSource = readFileSync("src/lib/progress/weekly-equivalent-progress.ts", "utf8");
const santiagoTrainingDateSource = readFileSync("src/lib/training/santiago-training-date.ts", "utf8");
const exerciseNameNormalizationSource = readFileSync("src/lib/training/exercise-name-normalization.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const integratedSource = [
  appSource,
  weeklyProgressSource,
  dashboardSource,
  dashboardCalendarSource,
  metricSummarySource,
  weeklyEquivalentProgressSource,
  santiagoTrainingDateSource,
  exerciseNameNormalizationSource,
].join("\n");

for (const modulePath of [
  "@/lib/progress/metric-insight",
  "@/lib/progress/week-day",
  "@/lib/progress/weight-format",
  "@/lib/progress/weekly-progress-chart",
]) {
  assert.match(integratedSource, new RegExp(`from "${modulePath}"`));
}

for (const helperName of [
  "parseDateKeyAsLocalNoon",
  "buildSvgPath",
  "buildAreaPath",
  "formatMetricDifference",
  "buildMetricInsight",
  "formatKgNullable",
]) {
  assert.match(integratedSource, new RegExp(`${helperName}\\(`), `${helperName} conserva call-sites productivos`);
  assert.doesNotMatch(
    integratedSource,
    new RegExp(`^\\s*function\\s+${helperName}\\b`, "m"),
    `${helperName} no conserva una implementación local duplicada`,
  );
}

assert.match(appSource, /import \{ DashboardScreen \} from "@\/features\/dashboard\/components\/dashboard-screen";/);
assert.match(weeklyProgressSource, /export function WeeklyProgressSvg\(/);
assert.match(weeklyProgressSource, /const currentPath = buildSvgPath\(currentPoints\)/);
assert.match(weeklyProgressSource, /const currentAreaPath = buildAreaPath\(currentPoints\)/);
assert.match(metricSummarySource, /formatMetricDifference\(summary\.difference, metric\)/);
assert.match(metricSummarySource, /buildMetricInsight\(summary\.difference, metric\)/);
assert.match(dashboardCalendarSource, /parseDateKeyAsLocalNoon\(todayKey\)/);
assert.match(weeklyProgressSource, /formatKgNullable\(activeCurrentPoint\?\.value \?\? null\)/);
assert.match(weeklyProgressSource, /useState\(chart\.activeIndex\)/);
assert.match(weeklyProgressSource, /useEffect\(\(\) => \{/);
assert.match(weeklyProgressSource, /useMemo\(\(\) => buildWeeklyProgressChart\(/);

assert.match(weeklyEquivalentProgressSource, /from "@\/lib\/training\/santiago-training-date";/);
assert.match(weeklyEquivalentProgressSource, /from "@\/lib\/training\/exercise-name-normalization";/);
assert.doesNotMatch(weeklyEquivalentProgressSource, /from "@\/lib\/dashboard\//);
const transversalSources = [
  weeklyEquivalentProgressSource,
  dashboardCalendarSource,
  santiagoTrainingDateSource,
  exerciseNameNormalizationSource,
].join("\n");
for (const helperName of ["normalizeEntryDateKey", "getSantiagoDateKey", "removeAccents"]) {
  assert.equal(
    (transversalSources.match(new RegExp(`^(?:export\\s+)?function ${helperName}\\b`, "gm")) ?? []).length,
    1,
    `${helperName} conserva una sola declaracion productiva`,
  );
  assert.doesNotMatch(weeklyEquivalentProgressSource, new RegExp(`^\\s*function ${helperName}\\b`, "m"));
}
assert.doesNotMatch(
  [santiagoTrainingDateSource, exerciseNameNormalizationSource].join("\n"),
  /from "@\/(?:features|lib\/(?:dashboard|progress))\//,
);

const registration = "tsx src/lib/progress/progress-helper-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("progress helper static integration source contract tests passed");
