import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Progress visual integration contract only.
 *
 * This test does not render React, simulate interactions or execute Recharts.
 * Behavioral coverage remains in the pure Progress tests.
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
const featureSource = [...sources.values()].join("\n");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");

for (const componentName of [
  "ComparisonScreenV2",
  "WeeklyResultsPanel",
  "WeeklySeriesColumn",
  "WeeklyMetricProgressCard",
  "WeeklyMetricSummaryView",
]) {
  assert.equal(
    (featureSource.match(new RegExp(`export function ${componentName}\\b`, "g")) ?? []).length,
    1,
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

const comparisonSource = sources.get(paths[0]) ?? "";
assert.match(appSource, /import \{ ComparisonScreenV2 \} from "@\/features\/progress\/components\/comparison-screen-v2";/);
assert.match(appSource, /<ComparisonScreenV2/);
assert.match(comparisonSource, /className="screen weekly-comparison-screen" data-section="weekly-comparison"/);
assert.match(comparisonSource, /useState\(""\)/);
assert.match(comparisonSource, /useState<number \| null>\(null\)/);
assert.equal((comparisonSource.match(/useEffect\(/g) ?? []).length, 2);
assert.match(featureSource, /formatWeeklyComparisonDate\(record\.date\)/);
assert.match(featureSource, /formatWeeklyComparisonDate\(baseline\.date\)/);
assert.match(featureSource, /<ResponsiveContainer width="100%" height=\{210\}>/);

const registration = "tsx src/features/progress/progress-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("progress visual static integration contract tests passed");
