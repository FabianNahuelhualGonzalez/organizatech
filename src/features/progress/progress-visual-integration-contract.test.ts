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
assert.match(comparisonSource, /model: WeeklyExerciseComparisonModel;/);
assert.match(comparisonSource, /routineDays: readonly string\[\];/);
assert.match(comparisonSource, /onDaySelect: \(day: string\) => void;/);
assert.match(comparisonSource, /onExerciseSelect: \(exerciseId: string\) => void;/);
assert.match(comparisonSource, /onWeekSelect: \(week: number\) => void;/);
assert.doesNotMatch(comparisonSource, /\buseState\b|\buseEffect\b|\buseMemo\b/);
assert.doesNotMatch(comparisonSource, /\bbuildWeeklyExerciseComparisonModel\b/);
assert.match(comparisonSource, /value=\{model\.selectedDay\}/);
assert.match(comparisonSource, /exercise\.isSelected/);
assert.match(comparisonSource, /value=\{model\.selectedWeek \?\? ""\}/);
assert.match(comparisonSource, /event\.stopPropagation\(\)/);
assert.match(appSource, /model=\{progressControllerView\.comparisonModel\}/);
assert.match(featureSource, /formatWeeklyComparisonDate\(record\.date\)/);
assert.match(featureSource, /formatWeeklyComparisonDate\(baseline\.date\)/);
assert.match(featureSource, /<ResponsiveContainer width="100%" height=\{210\}>/);

const registration = "tsx src/features/progress/progress-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

// -------------------------------------------------------------------------------------------
// P3-38 — ShareWorkoutCard (preparación visual aislada).
//
// Contrato ESTÁTICO/SOURCE-BASED: lee el código fuente, no renderiza React ni ejecuta el
// componente. Esta tarea NO integra selección, datos reales ni Web Share — solo prepara un
// componente presentacional puro para una integración posterior (P3-39). No hay cobertura
// runtime aquí: el harness `tsx` que ejecuta esta suite no monta JSX (ver nota equivalente en
// `app-shell-visual-integration-contract.test.ts`).
// -------------------------------------------------------------------------------------------
const shareCardPath = "src/features/progress/components/share-workout-card.tsx";
const shareCardSource = readFileSync(shareCardPath, "utf8");
const shareCardCssPath = "src/features/progress/components/share-workout-card.module.css";
const shareCardCssSource = readFileSync(shareCardCssPath, "utf8");

// Export único de ShareWorkoutCard.
assert.equal(
  (shareCardSource.match(/^export function ShareWorkoutCard\b/gm) ?? []).length,
  1,
  "debe existir una unica definicion productiva de ShareWorkoutCard",
);
assert.doesNotMatch(appSource, /ShareWorkoutCard/, "ShareWorkoutCard no debe estar integrado en el root todavia (P3-39)");

// API allowlisted: modelo y props exactos, sin campos de dominio ni identificadores internos.
assert.match(shareCardSource, /title: string;/);
assert.match(shareCardSource, /periodLabel: string;/);
assert.match(shareCardSource, /detailLines: readonly ShareWorkoutCardDetailLine\[\];/);
assert.match(shareCardSource, /footer\?: string;/);
assert.match(shareCardSource, /onShare: \(\) => void;/);
assert.match(shareCardSource, /isSharing\?: boolean;/);
assert.match(shareCardSource, /statusMessage\?: string \| null;/);
assert.match(shareCardSource, /statusTone\?: StatusMessageTone;/);

const shareCardCode = shareCardSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const forbidden of [
  // Tipos y campos de dominio: el componente solo recibe strings ya formateados.
  /\bExerciseEntry\b/,
  /\bExerciseMetrics\b/,
  /\bTrainingSession\b/,
  /\buuid\b/i,
  /\bentryId\b/,
  /\bexerciseId\b/,
  /\btrainingCycleExerciseId\b/,
  /\bcycleId\b/,
  /\blineage\b/i,
  /\buserId\b/,
  /\bemail\b/i,
  /\btimestamp\b/i,
  // Hooks: presentacional puro, sin estado propio.
  /\buseState\b/,
  /\buseEffect\b/,
  /\buseRef\b/,
  /\buseMemo\b/,
  /\buseCallback\b/,
  /\buseReducer\b/,
  // APIs de navegador, captura y descarga.
  /navigator\.share/,
  /navigator\.clipboard/,
  /\bdocument\./,
  /\bwindow\./,
  /\bcanvas\b/i,
  /\bBlob\b/,
  /\bURL\b/,
  /\bFile\b/,
  /\bhtml2canvas\b/i,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
]) {
  assert.doesNotMatch(shareCardCode, forbidden, `ShareWorkoutCard no debe incorporar ${forbidden}`);
}

// La sección raíz no lleva onClick (único control interactivo es el Button de compartir).
assert.doesNotMatch(shareCardCode, /<section[^>]*onClick/, "la tarjeta no debe tener onClick propio");
assert.equal((shareCardCode.match(/onClick=/g) ?? []).length, 1, "debe haber un unico manejador onClick, en el boton de compartir");

// Sin storage, repositories, Supabase, env ni navegación.
for (const forbiddenImport of [
  "@/lib/storage/",
  "@/lib/supabase/",
  "@/lib/data/repository",
  "-repository",
  "process.env",
  "@/lib/navigation/",
  "@/lib/auth/",
]) {
  assert.doesNotMatch(shareCardCode, new RegExp(forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

// Reutiliza Button y StatusMessage compartidos; un único <button> resultante.
assert.match(shareCardSource, /import \{ Button \} from "@\/ui\/buttons\/button";/);
assert.match(shareCardSource, /import \{ StatusMessage, type StatusMessageTone \} from "@\/ui\/feedback\/status-message";/);
assert.doesNotMatch(shareCardSource, /<button\b/, "no debe declarar un <button> nativo propio, debe delegar en Button");
assert.equal((shareCardSource.match(/<Button\b/g) ?? []).length, 1, "un unico Button, el control interactivo de la tarjeta");
assert.equal((shareCardSource.match(/<StatusMessage\b/g) ?? []).length, 1);

// CSS Module: import correcto, sin tocar globals.css, CTA de al menos 44px y min-width: 0.
assert.match(shareCardSource, /import styles from "\.\/share-workout-card\.module\.css";/);
assert.doesNotMatch(shareCardSource, /className="[^"]/, "las clases deben venir del CSS module, no de globals.css");
assert.match(shareCardCssSource, /min-height:\s*44px;/);
assert.match(shareCardCssSource, /\.shareButton\s*\{[^}]*min-height:\s*44px;/);
assert.ok((shareCardCssSource.match(/min-width:\s*0;/g) ?? []).length >= 3, "min-width: 0 debe aplicarse en los contenedores flexibles");
assert.match(shareCardCssSource, /overflow-wrap:\s*break-word;/, "debe existir wrapping seguro para textos largos");
assert.doesNotMatch(shareCardCssSource, /^\.card\s*\{/m, "no debe duplicar globalmente la clase .card");

// El unico Button declara type explicito y conserva callback, disabled y busy label.
assert.match(
  shareCardSource,
  /<Button className=\{styles\.shareButton\} type="button" onClick=\{onShare\} disabled=\{isSharing\}>/,
  "el Button debe declarar type=\"button\" y conservar className, onClick y disabled",
);
assert.match(shareCardSource, /\{isSharing \? "Compartiendo\.\.\." : "Compartir"\}/, "busy label explicito, sin estado local");

// StatusMessage conserva el tono recibido y muestra el mensaje recibido: feedback 100% por props.
assert.match(shareCardSource, /<StatusMessage className=\{styles\.status\} tone=\{statusTone\}>/);
assert.match(shareCardSource, /\{statusMessage\}\s*<\/StatusMessage>/, "StatusMessage debe mostrar statusMessage");
assert.match(shareCardSource, /statusMessage \? \(/, "el feedback se renderiza solo cuando llega por props");

// P3-38 es preparacion aislada: el componente NO esta integrado todavia (eso es P3-39).
const comparisonScreenSource = readFileSync("src/features/progress/components/comparison-screen-v2.tsx", "utf8");
assert.doesNotMatch(comparisonScreenSource, /ShareWorkoutCard/, "ComparisonScreenV2 no debe importarlo ni usarlo todavia");
assert.doesNotMatch(comparisonScreenSource, /share-workout-card/, "ComparisonScreenV2 no debe importar el modulo ni su CSS module");

// No se registra un segundo test/script de ShareWorkoutCard; el contrato Progress sigue una sola vez.
assert.doesNotMatch(packageSource, /share-workout-card/, "P3-38 no debe registrar scripts propios en package.json");

console.log("progress visual static integration contract tests passed");
