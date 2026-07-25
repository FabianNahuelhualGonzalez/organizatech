import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Progress helper integration source contract only.
 *
 * This test does not render React, simulate interactions or execute hooks.
 * Runtime behavior is covered by the unit tests for each extracted module.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageStaticSource = readFileSync("package.json", "utf8");

for (const modulePath of [
  "@/lib/progress/metric-insight",
  "@/lib/progress/week-day",
  "@/lib/progress/weight-format",
  "@/lib/progress/weekly-progress-chart",
]) {
  assert.match(appStaticSource, new RegExp(`from "${modulePath}"`));
}

for (const helperName of [
  "parseDateKeyAsLocalNoon",
  "buildSvgPath",
  "buildAreaPath",
  "formatMetricDifference",
  "buildMetricInsight",
  "formatKgNullable",
]) {
  assert.match(appStaticSource, new RegExp(`${helperName}\\(`), `${helperName} conserva call-sites productivos`);
  assert.doesNotMatch(
    appStaticSource,
    new RegExp(`^\\s*function\\s+${helperName}\\b`, "m"),
    `${helperName} no conserva una implementacion local duplicada`,
  );
}

assert.match(appStaticSource, /function WeeklyProgressSvg\(/);
assert.match(appStaticSource, /const currentPath = buildSvgPath\(currentPoints\)/);
assert.match(appStaticSource, /const currentAreaPath = buildAreaPath\(currentPoints\)/);
assert.match(appStaticSource, /formatMetricDifference\(summary\.difference, metric\)/);
assert.match(appStaticSource, /buildMetricInsight\(summary\.difference, metric\)/);
assert.match(appStaticSource, /parseDateKeyAsLocalNoon\(todayKey\)/);
assert.match(appStaticSource, /formatKgNullable\(activeCurrentPoint\?\.value \?\? null\)/);

// Dashboard mantiene su frontera previamente integrada; este contrato no la sustituye.
assert.match(appStaticSource, /from "@\/lib\/dashboard\/dashboard-card-model"/);
assert.match(appStaticSource, /buildDashboardTrainingCardModel\(/);
assert.match(appStaticSource, /resolveDashboardCardVisibility\(/);

// Estado, refs y efectos permanecen en React.
assert.match(appStaticSource, /useState\(chart\.activeIndex\)/);
assert.match(appStaticSource, /useEffect\(\(\) => \{/);
assert.match(appStaticSource, /useMemo\(\(\) => buildWeeklyProgressChart\(/);
assert.match(appStaticSource, /useRef</);

const testRegistration = "tsx src/lib/progress/progress-helper-integration-contract.test.ts";
assert.equal(packageStaticSource.split(testRegistration).length - 1, 1);

console.log("progress helper static integration source contract tests passed");
