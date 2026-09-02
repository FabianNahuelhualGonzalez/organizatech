import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { formatWeeklyComparisonDate } from "./weekly-comparison-date";

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
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");
const userPortalShellStylesSource = readFileSync(
  "src/features/user-portal-shell/components/user-portal-shell.module.css",
  "utf8",
);

const originalTimeZone = process.env.TZ;
try {
  for (const timeZone of ["UTC", "America/Santiago", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
    process.env.TZ = timeZone;
    assert.equal(formatWeeklyComparisonDate("2026-09-01"), "01-09-2026");
    assert.equal(formatWeeklyComparisonDate("2026-08-18"), "18-08-2026");
    assert.equal(formatWeeklyComparisonDate("2025-12-31"), "31-12-2025");
    assert.equal(formatWeeklyComparisonDate("2026-01-01"), "01-01-2026");
    assert.equal(formatWeeklyComparisonDate("2024-02-29"), "29-02-2024");
  }

  process.env.TZ = "America/Santiago";
  assert.equal(formatWeeklyComparisonDate("2026-09-01T12:00:00.000Z"), "01-09-2026");
  process.env.TZ = "Pacific/Kiritimati";
  assert.equal(formatWeeklyComparisonDate("2026-09-01T12:00:00.000Z"), "02-09-2026");
} finally {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
}

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
const weeklyResultsPanelSource = sources.get(paths[1]) ?? "";
const weeklySeriesColumnSource = sources.get(paths[2]) ?? "";
assert.match(appSource, /import type \{ ComparisonScreenV2Props \} from "@\/features\/progress\/components\/comparison-screen-v2";/);
assert.match(
  appSource,
  /const ComparisonScreenV2 = dynamic<ComparisonScreenV2Props>\([\s\S]*?import\("@\/features\/progress\/components\/comparison-screen-v2"\)[\s\S]*?module\.ComparisonScreenV2[\s\S]*?\);/,
);
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
assert.ok(
  weeklyResultsPanelSource.indexOf('title={`Semana ${baseline.week}`}') <
    weeklyResultsPanelSource.indexOf('title={`Semana ${effective?.week ?? "—"}`}'),
  "UI-NAV-01V: Semana inicial debe permanecer a la izquierda de la semana elegida",
);
assert.equal(
  weeklyResultsPanelSource.split("Primer registro vs semana elegida").length - 1,
  1,
  "UI-NAV-01V: Tus resultados debe conservar el texto final aprobado una sola vez",
);
assert.match(
  weeklySeriesColumnSource,
  /record\.reps\.map\(\(reps, index\) => \([\s\S]*?className="weekly-series-pill"[\s\S]*?<span>S\{index \+ 1\}:<\/span>[\s\S]*?<strong>\{formatKg\(record\.weight\)\} · \{reps\} reps<\/strong>/,
  "UI-NAV-01V: cada columna debe conservar sus series completas con peso y repeticiones",
);

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

// -------------------------------------------------------------------------------------------
// UI-NAV-01V — contrato estructural de Comparación semanal.
// Analiza CSS ejecutable y TSX mediante AST; comentarios, strings y formato no satisfacen estas
// barreras. No renderiza navegador: la QA visual real sigue correspondiendo al dueño de producto.
// -------------------------------------------------------------------------------------------

interface ProgressCssDeclaration {
  property: string;
  value: string;
  important: boolean;
  declarationOrder: number;
}

interface ProgressCssRule {
  selectors: string[];
  declarations: ProgressCssDeclaration[];
  minWidth: number;
  maxWidth: number;
  order: number;
}

function stripProgressCssComments(source: string) {
  let result = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === "\\") {
        result += next ?? "";
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      assert.ok(closing >= 0, "UI-NAV-01V CSS: comentario sin cierre");
      result += " ".repeat(closing + 2 - index);
      index = closing + 1;
      continue;
    }
    result += character;
  }
  assert.equal(quote, "", "UI-NAV-01V CSS: string sin cierre");
  return result;
}

function findProgressCssToken(source: string, start: number, token: string) {
  let quote = "";
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === token && parentheses === 0 && brackets === 0) return index;
  }
  return -1;
}

function findProgressCssClosingBrace(source: string, openingBrace: number) {
  let quote = "";
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      assert.ok(depth >= 0, "UI-NAV-01V CSS: llave de cierre inesperada");
    }
  }
  assert.fail("UI-NAV-01V CSS: bloque sin cierre");
}

function splitProgressCssOutsideGroups(source: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === delimiter && parentheses === 0 && brackets === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function parseProgressCssDeclarations(body: string) {
  return splitProgressCssOutsideGroups(body, ";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration, declarationOrder): ProgressCssDeclaration => {
      const colon = findProgressCssToken(declaration, 0, ":");
      assert.ok(colon > 0, `UI-NAV-01V CSS: declaración inválida (${declaration})`);
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const rawValue = declaration.slice(colon + 1).trim();
      const important = /\s*!important\s*$/i.test(rawValue);
      const value = rawValue.replace(/\s*!important\s*$/i, "");
      assert.match(property, /^--[a-z0-9-]+$|^-?[a-z][a-z0-9-]*$/i);
      assert.ok(value, `UI-NAV-01V CSS: ${property} sin valor`);
      return { property, value, important, declarationOrder };
    });
}

function parseProgressCss(source: string) {
  const executable = stripProgressCssComments(source);
  const rules: ProgressCssRule[] = [];
  let order = 0;

  const visit = (block: string, inheritedMin: number, inheritedMax: number) => {
    let cursor = 0;
    while (cursor < block.length) {
      const opening = findProgressCssToken(block, cursor, "{");
      if (opening < 0) {
        assert.equal(block.slice(cursor).trim(), "", "UI-NAV-01V CSS: contenido fuera de regla");
        break;
      }
      const prelude = block.slice(cursor, opening).trim();
      assert.ok(prelude, "UI-NAV-01V CSS: regla sin selector");
      const closing = findProgressCssClosingBrace(block, opening);
      const body = block.slice(opening + 1, closing);
      if (/^@media\b/i.test(prelude)) {
        const min = prelude.match(/min-width\s*:\s*(\d+(?:\.\d+)?)px/i);
        const max = prelude.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/i);
        visit(
          body,
          Math.max(inheritedMin, min ? Number(min[1]) : 0),
          Math.min(inheritedMax, max ? Number(max[1]) : Number.POSITIVE_INFINITY),
        );
      } else if (/^@supports\b/i.test(prelude)) {
        visit(body, inheritedMin, inheritedMax);
      } else if (!prelude.startsWith("@")) {
        rules.push({
          selectors: splitProgressCssOutsideGroups(prelude, ",").map((selector) => selector.trim()),
          declarations: parseProgressCssDeclarations(body),
          minWidth: inheritedMin,
          maxWidth: inheritedMax,
          order,
        });
        order += 1;
      }
      cursor = closing + 1;
    }
  };

  visit(executable, 0, Number.POSITIVE_INFINITY);
  return rules;
}

function normalizeProgressCssValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function normalizeProgressSelector(selector: string) {
  return selector.replace(/\s+/g, " ").trim();
}

interface ProgressCssElement {
  tag?: string;
  classes?: readonly string[];
  pseudoElement?: string;
  adjacentPreviousSiblings?: readonly ProgressCssElement[];
  generalPreviousSiblings?: readonly ProgressCssElement[];
}

interface ProgressCssTarget extends ProgressCssElement {
  label: string;
  ancestors?: readonly ProgressCssElement[];
  allowAnyAncestorPrefix?: boolean;
  ancestorPrefixBoundary?: number;
}

const progressCssTargets = {
  comparisonHeaderCell: {
    label: "celda Series de Comparación",
    tag: "span",
    adjacentPreviousSiblings: [{ tag: "span" }],
    generalPreviousSiblings: [{ tag: "span" }],
    ancestors: [
      { classes: ["weekly-plan-row", "heading"] },
      { tag: "div" },
      { classes: ["weekly-plan-table"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 1,
  },
  comparisonHeadingRow: {
    label: "cabecera semanal de Comparación",
    classes: ["weekly-plan-row", "heading"],
    ancestors: [
      { classes: ["weekly-plan-table"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 0,
  },
  weeklySeriesPill: {
    label: ".weekly-series-pill",
    classes: ["weekly-series-pill"],
    adjacentPreviousSiblings: [
      { classes: ["weekly-series-pill"] },
      { tag: "small" },
    ],
    generalPreviousSiblings: [
      { classes: ["weekly-series-pill"] },
      { tag: "small" },
      { tag: "span" },
    ],
    ancestors: [
      { classes: ["weekly-series-column"] },
      { classes: ["weekly-results-grid"] },
      { classes: ["weekly-results-card"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 0,
  },
  weeklySeriesPillSpan: {
    label: ".weekly-series-pill span",
    tag: "span",
    ancestors: [
      { classes: ["weekly-series-pill"] },
      { classes: ["weekly-series-column"] },
      { classes: ["weekly-results-grid"] },
      { classes: ["weekly-results-card"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 1,
  },
  weeklySeriesPillStrong: {
    label: ".weekly-series-pill strong",
    tag: "strong",
    adjacentPreviousSiblings: [{ tag: "span" }],
    generalPreviousSiblings: [{ tag: "span" }],
    ancestors: [
      { classes: ["weekly-series-pill"] },
      { classes: ["weekly-series-column"] },
      { classes: ["weekly-results-grid"] },
      { classes: ["weekly-results-card"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 1,
  },
  weeklyResultsGrid: {
    label: ".weekly-results-grid",
    classes: ["weekly-results-grid"],
    ancestors: [
      { classes: ["weekly-results-card"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 0,
  },
  weeklyResultsDivider: {
    label: ".weekly-results-grid::before",
    classes: ["weekly-results-grid"],
    pseudoElement: "before",
    ancestors: [
      { classes: ["weekly-results-card"] },
      { classes: ["weekly-comparison-section"] },
      { classes: ["weekly-comparison-shell"] },
      { classes: ["weekly-comparison-screen", "screen"] },
      { classes: ["content"] },
      { classes: ["backgroundLayer"] },
      { tag: "main", classes: ["app-shell", "shell"] },
    ],
    allowAnyAncestorPrefix: true,
    ancestorPrefixBoundary: 0,
  },
} satisfies Record<string, ProgressCssTarget>;

type ProgressSelectorCombinator = "descendant" | "child" | "adjacent" | "sibling";

function parseProgressSelectorStructure(selector: string) {
  const normalized = normalizeProgressSelector(selector);
  const compounds: string[] = [];
  const combinators: ProgressSelectorCombinator[] = [];
  let current = "";
  let quote = "";
  let parentheses = 0;
  let brackets = 0;
  let pendingWhitespace = false;

  const pushCurrent = () => {
    const compound = current.trim();
    if (compound) compounds.push(compound);
    current = "";
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (quote) {
      current += character;
      if (character === "\\") {
        current += normalized[index + 1] ?? "";
        index += 1;
      } else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === "(") {
      parentheses += 1;
      current += character;
    } else if (character === ")") {
      parentheses -= 1;
      current += character;
    } else if (character === "[") {
      brackets += 1;
      current += character;
    } else if (character === "]") {
      brackets -= 1;
      current += character;
    } else if (parentheses === 0 && brackets === 0 && /\s/.test(character)) {
      pushCurrent();
      pendingWhitespace = compounds.length > combinators.length;
    } else if (parentheses === 0 && brackets === 0 && (character === ">" || character === "+" || character === "~")) {
      pushCurrent();
      assert.ok(
        compounds.length > combinators.length,
        `UI-NAV-01V CSS: combinador sin lado izquierdo (${selector})`,
      );
      combinators.push(character === ">" ? "child" : character === "+" ? "adjacent" : "sibling");
      pendingWhitespace = false;
    } else {
      if (pendingWhitespace) {
        combinators.push("descendant");
        pendingWhitespace = false;
      }
      current += character;
    }
  }
  pushCurrent();
  assert.equal(
    combinators.length,
    Math.max(0, compounds.length - 1),
    `UI-NAV-01V CSS: relación de selector incompleta (${selector})`,
  );
  return { compounds, combinators };
}

function progressSelectorCompounds(selector: string) {
  return parseProgressSelectorStructure(selector).compounds;
}

function progressCompoundMatchesElement(compound: string, element: ProgressCssElement) {
  const pseudoElements = [...compound.matchAll(/::([a-z-]+)/gi)].map((match) => match[1].toLowerCase());
  if (element.pseudoElement) {
    if (pseudoElements.length !== 1 || pseudoElements[0] !== element.pseudoElement.toLowerCase()) return false;
  } else if (pseudoElements.length > 0) return false;
  const classes = new Set(element.classes ?? []);
  for (const match of compound.matchAll(/\.([_a-z][\w-]*)/gi)) {
    if (!classes.has(match[1])) return false;
  }
  const tag = compound
    .replace(/#[\w-]+/g, "")
    .replace(/\.[\w-]+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/::[\w-]+/g, "")
    .replace(/:[\w-]+(?:\([^)]*\))?/g, "")
    .trim();
  return !tag || tag === "*" || tag.toLowerCase() === element.tag?.toLowerCase();
}

interface ProgressProtectedSelectorState {
  parentAncestorIndex: number;
  structuralDepth: number;
  adjacentPreviousSiblings: readonly ProgressCssElement[];
  generalPreviousSiblings: readonly ProgressCssElement[];
}

function progressSelectorMatchesProtectedTarget(
  compounds: readonly string[],
  combinators: readonly ProgressSelectorCombinator[],
  target: ProgressCssTarget,
) {
  const ancestors = target.ancestors ?? [];
  const prefixBoundary = target.ancestorPrefixBoundary ?? 0;
  const targetCompoundIsSelfIdentifying = (target.classes?.length ?? 0) > 0;
  let states: ProgressProtectedSelectorState[] = [{
    parentAncestorIndex: 0,
    structuralDepth: 0,
    adjacentPreviousSiblings: target.adjacentPreviousSiblings ?? [],
    generalPreviousSiblings: target.generalPreviousSiblings ?? [],
  }];

  const boundarySatisfied = (state: ProgressProtectedSelectorState) => (
    (targetCompoundIsSelfIdentifying && prefixBoundary === 0) ||
    state.structuralDepth >= prefixBoundary
  );

  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    const combinator = combinators[index];
    const nextStates: ProgressProtectedSelectorState[] = [];
    for (const state of states) {
      if (combinator === "child") {
        const ancestor = ancestors[state.parentAncestorIndex];
        if (ancestor && progressCompoundMatchesElement(compounds[index], ancestor)) {
          nextStates.push({
            parentAncestorIndex: state.parentAncestorIndex + 1,
            structuralDepth: Math.max(state.structuralDepth, state.parentAncestorIndex + 1),
            adjacentPreviousSiblings: ancestor.adjacentPreviousSiblings ?? [],
            generalPreviousSiblings: ancestor.generalPreviousSiblings ?? [],
          });
        }
        continue;
      }
      if (combinator === "descendant") {
        for (let ancestorIndex = state.parentAncestorIndex; ancestorIndex < ancestors.length; ancestorIndex += 1) {
          const ancestor = ancestors[ancestorIndex];
          if (!progressCompoundMatchesElement(compounds[index], ancestor)) continue;
          nextStates.push({
            parentAncestorIndex: ancestorIndex + 1,
            structuralDepth: Math.max(state.structuralDepth, ancestorIndex + 1),
            adjacentPreviousSiblings: ancestor.adjacentPreviousSiblings ?? [],
            generalPreviousSiblings: ancestor.generalPreviousSiblings ?? [],
          });
        }
        continue;
      }
      const siblingCandidates = combinator === "adjacent"
        ? state.adjacentPreviousSiblings
        : state.generalPreviousSiblings;
      for (const sibling of siblingCandidates) {
        if (!progressCompoundMatchesElement(compounds[index], sibling)) continue;
        nextStates.push({
          parentAncestorIndex: state.parentAncestorIndex,
          structuralDepth: state.structuralDepth,
          adjacentPreviousSiblings: sibling.adjacentPreviousSiblings ?? [],
          generalPreviousSiblings: sibling.generalPreviousSiblings ?? [],
        });
      }
    }

    if (nextStates.length > 0) {
      states = nextStates;
      continue;
    }
    if (combinator === "descendant" && states.some(boundarySatisfied)) return true;
    return false;
  }
  return states.length > 0;
}

function progressSelectorMatchesTarget(selector: string, target: ProgressCssTarget) {
  const { compounds, combinators } = parseProgressSelectorStructure(selector);
  if (compounds.length === 0 || !progressCompoundMatchesElement(compounds.at(-1)!, target)) {
    return false;
  }
  if (target.allowAnyAncestorPrefix) {
    return progressSelectorMatchesProtectedTarget(compounds, combinators, target);
  }
  const ancestors = target.ancestors ?? [];
  let ancestorIndex = 0;
  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    const combinator = combinators[index];
    if (combinator === "descendant" || combinator === "child") {
      let candidateIndex = ancestorIndex;
      const maximumAncestorIndex = combinator === "child"
        ? Math.min(ancestors.length, ancestorIndex + 1)
        : ancestors.length;
      while (candidateIndex < maximumAncestorIndex) {
        if (progressCompoundMatchesElement(compounds[index], ancestors[candidateIndex])) {
          ancestorIndex = candidateIndex + 1;
          break;
        }
        candidateIndex += 1;
      }
      if (candidateIndex < maximumAncestorIndex) continue;
    }

    // El extremo derecho y la cadena estructural conocida ya identifican el objetivo.
    // El resto es un prefijo contextual potencial (shell, layout o wrapper futuro), cuya
    // especificidad completa se conserva para resolver la cascada.
    const externalTag = compounds[index]
      .replace(/:[\w-]+(?:\([^)]*\))?/g, "")
      .trim()
      .toLowerCase();
    if (
      combinator === "descendant" &&
      /^(?:html|body|main)$/.test(externalTag) &&
      !/[.#\[]/.test(compounds[index])
    ) {
      ancestorIndex = ancestors.length;
      continue;
    }
    return false;
  }
  return true;
}

function progressCssSpecificity(selector: string) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attributes = (selector.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const pseudoClasses = (selector.replace(/::[\w-]+/g, "").match(/:[\w-]+/g) ?? []).length;
  const types = progressSelectorCompounds(selector).filter((compound) => /^[a-z][\w-]*/i.test(compound)).length;
  return [ids, classes + attributes + pseudoClasses, types + pseudoElements] as const;
}

function compareProgressSpecificity(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function resolveProgressDeclarationValue(
  declaration: ProgressCssDeclaration,
  property: string,
) {
  if (declaration.property === property) return declaration.value;
  if (
    (property === "overflow-x" || property === "overflow-y") &&
    declaration.property === "overflow"
  ) return declaration.value;
  if (property === "background-color" && declaration.property === "background") {
    return declaration.value;
  }
  return null;
}

function readProgressTargetCssValue(input: {
  rules: readonly ProgressCssRule[];
  target: ProgressCssTarget;
  property: string;
  viewportWidth: number;
}) {
  let winner: {
    value: string;
    important: boolean;
    specificity: readonly number[];
    order: number;
  } | null = null;
  for (const rule of input.rules) {
    if (input.viewportWidth < rule.minWidth || input.viewportWidth > rule.maxWidth) continue;
    for (const selector of rule.selectors) {
      if (!progressSelectorMatchesTarget(selector, input.target)) continue;
      const specificity = progressCssSpecificity(selector);
      for (const declaration of rule.declarations) {
        const value = resolveProgressDeclarationValue(declaration, input.property);
        if (value === null) continue;
        const order = (rule.order * 1000) + declaration.declarationOrder;
        const wins = !winner ||
          Number(declaration.important) > Number(winner.important) ||
          (
            declaration.important === winner.important &&
            (
              compareProgressSpecificity(specificity, winner.specificity) > 0 ||
              (compareProgressSpecificity(specificity, winner.specificity) === 0 && order > winner.order)
            )
          );
        if (wins) winner = { value, important: declaration.important, specificity, order };
      }
    }
  }
  return winner?.value ?? null;
}

function readProgressCssValue(input: {
  rules: readonly ProgressCssRule[];
  selector: string;
  property: string;
  viewportWidth: number;
  required: false;
}): string | null;
function readProgressCssValue(input: {
  rules: readonly ProgressCssRule[];
  selector: string;
  property: string;
  viewportWidth: number;
  required?: true;
}): string;
function readProgressCssValue(input: {
  rules: readonly ProgressCssRule[];
  selector: string;
  property: string;
  viewportWidth: number;
  required?: boolean;
}) {
  let value: string | null = null;
  let winner: { important: boolean; order: number } | null = null;
  const expectedSelector = normalizeProgressSelector(input.selector);
  for (const rule of input.rules) {
    if (input.viewportWidth < rule.minWidth || input.viewportWidth > rule.maxWidth) continue;
    if (!rule.selectors.some((selector) => normalizeProgressSelector(selector) === expectedSelector)) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property !== input.property) continue;
      const order = (rule.order * 1000) + declaration.declarationOrder;
      const wins = !winner ||
        Number(declaration.important) > Number(winner.important) ||
        (declaration.important === winner.important && order > winner.order);
      if (!wins) continue;
      value = declaration.value;
      winner = { important: declaration.important, order };
    }
  }
  if (value === null) {
    if (input.required === false) return null;
    assert.fail(`UI-NAV-01V CSS: falta ${input.property} en ${input.selector} a ${input.viewportWidth}px`);
  }
  return value;
}

function splitProgressCssWhitespace(source: string) {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index] ?? " ";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (/\s/.test(character) && parentheses === 0 && brackets === 0) {
      const part = source.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  return parts;
}

function evaluateProgressCssLength(valueInput: string, viewportWidth: number): number {
  const value = normalizeProgressCssValue(valueInput).toLowerCase();
  if (/^[-+]?(?:0+(?:\.0*)?|\.0+)$/.test(value)) return 0;
  const numeric = value.match(/^(-?\d*\.?\d+)(px|rem|vw|%)$/i);
  if (numeric) {
    const amount = Number(numeric[1]);
    if (numeric[2] === "px") return amount;
    if (numeric[2] === "rem") return amount * 16;
    if (numeric[2] === "%") return (amount / 100) * viewportWidth;
    return (amount / 100) * viewportWidth;
  }
  if (value === "initial" || value === "medium") return 16;
  for (const functionName of ["min", "max", "clamp"] as const) {
    const prefix = `${functionName}(`;
    if (!value.startsWith(prefix) || !value.endsWith(")")) continue;
    const parts = splitProgressCssOutsideGroups(value.slice(prefix.length, -1), ",")
      .map((part) => evaluateProgressCssLength(part, viewportWidth));
    if (functionName === "min") return Math.min(...parts);
    if (functionName === "max") return Math.max(...parts);
    assert.equal(parts.length, 3, `UI-NAV-01V CSS: clamp inválido (${valueInput})`);
    return Math.max(parts[0], Math.min(parts[1], parts[2]));
  }
  assert.fail(`UI-NAV-01V CSS: longitud no evaluable (${valueInput})`);
}

function evaluateProgressHorizontalInsets(valueInput: string, viewportWidth: number) {
  const parts = splitProgressCssWhitespace(normalizeProgressCssValue(valueInput));
  assert.ok(parts.length >= 1 && parts.length <= 4, `UI-NAV-01W CSS: shorthand inválido (${valueInput})`);
  if (parts.length === 1) return evaluateProgressCssLength(parts[0], viewportWidth) * 2;
  if (parts.length === 2 || parts.length === 3) {
    return evaluateProgressCssLength(parts[1], viewportWidth) * 2;
  }
  return evaluateProgressCssLength(parts[1], viewportWidth) +
    evaluateProgressCssLength(parts[3], viewportWidth);
}

function evaluateProgressBorderWidth(valueInput: string, viewportWidth: number) {
  const [width] = splitProgressCssWhitespace(normalizeProgressCssValue(valueInput));
  assert.ok(width, `UI-NAV-01W CSS: borde sin ancho (${valueInput})`);
  return evaluateProgressCssLength(width, viewportWidth);
}

function readProgressInheritedFontSizePixels(input: {
  rules: readonly ProgressCssRule[];
  target: ProgressCssTarget;
  ancestorTargets: readonly ProgressCssTarget[];
  viewportWidth: number;
}) {
  for (const target of [input.target, ...input.ancestorTargets]) {
    const value = readProgressTargetCssValue({
      rules: input.rules,
      target,
      property: "font-size",
      viewportWidth: input.viewportWidth,
    });
    if (value === null) continue;
    const normalized = normalizeProgressCssValue(value).toLowerCase();
    if (["inherit", "unset", "revert", "revert-layer"].includes(normalized)) continue;
    return evaluateProgressCssLength(normalized, input.viewportWidth);
  }
  assert.fail(
    `UI-NAV-01V: falta fuente efectiva para ${input.target.label} a ${input.viewportWidth}px`,
  );
}

function scaleValueHidesContent(valueInput: string) {
  const value = normalizeProgressCssValue(valueInput).toLowerCase();
  if (!value || value === "none") return false;
  const factors = value.split(/\s+/).filter(Boolean);
  const isZeroFactor = (factor: string) => /^[-+]?(?:0+(?:\.0*)?|\.0+)%?$/.test(factor);
  return factors.slice(0, 2).some(isZeroFactor);
}

function readProgressCssFunctions(valueInput: string) {
  const functions: Array<{ name: string; argumentsSource: string }> = [];
  for (let index = 0; index < valueInput.length;) {
    const character = valueInput[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < valueInput.length && valueInput[index] !== quote) {
        if (valueInput[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (!/[a-z_-]/i.test(character)) {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (index < valueInput.length && /[a-z0-9_-]/i.test(valueInput[index])) index += 1;
    const name = valueInput.slice(nameStart, index).toLowerCase();
    while (index < valueInput.length && /\s/.test(valueInput[index])) index += 1;
    if (valueInput[index] !== "(") continue;
    const argumentsStart = index + 1;
    let depth = 1;
    let quote = "";
    index += 1;
    for (; index < valueInput.length && depth > 0; index += 1) {
      const nestedCharacter = valueInput[index];
      if (quote) {
        if (nestedCharacter === "\\") index += 1;
        else if (nestedCharacter === quote) quote = "";
        continue;
      }
      if (nestedCharacter === '"' || nestedCharacter === "'") quote = nestedCharacter;
      else if (nestedCharacter === "(") depth += 1;
      else if (nestedCharacter === ")") depth -= 1;
    }
    assert.equal(depth, 0, `UI-NAV-01V CSS: función transform sin cierre (${valueInput})`);
    functions.push({
      name,
      argumentsSource: valueInput.slice(argumentsStart, index - 1),
    });
  }
  return functions;
}

function splitProgressScaleFactors(argumentsSource: string) {
  const commaSeparated = splitProgressCssOutsideGroups(argumentsSource, ",")
    .map((factor) => factor.trim())
    .filter(Boolean);
  if (commaSeparated.length > 1) return commaSeparated;

  const factors: string[] = [];
  let start = 0;
  let parentheses = 0;
  for (let index = 0; index <= argumentsSource.length; index += 1) {
    const character = argumentsSource[index] ?? " ";
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (/\s/.test(character) && parentheses === 0) {
      const factor = argumentsSource.slice(start, index).trim();
      if (factor) factors.push(factor);
      start = index + 1;
    }
  }
  return factors;
}

function transformScaleHidesContent(valueInput: string) {
  const isZeroFactor = (factor: string) => /^[-+]?(?:0+(?:\.0*)?|\.0+)%?$/.test(factor.trim());
  for (const cssFunction of readProgressCssFunctions(valueInput)) {
    if (!/^(?:scale|scalex|scaley|scalez|scale3d)$/.test(cssFunction.name)) continue;
    const factors = splitProgressScaleFactors(cssFunction.argumentsSource);
    const relevantFactors = cssFunction.name === "scale3d" ? factors.slice(0, 3) : factors.slice(0, 2);
    if (relevantFactors.some(isZeroFactor)) return true;
  }
  return false;
}

function progressCssValueIsZero(valueInput: string) {
  const value = normalizeProgressCssValue(valueInput).toLowerCase();
  return /^[-+]?(?:0+(?:\.0*)?|\.0+)(?:px|rem|vw|%)?$/.test(value) ||
    /^calc\([-+]?(?:0+(?:\.0*)?|\.0+)(?:px|rem|vw|%)?\)$/.test(value);
}

function progressCssColorIsTransparent(valueInput: string) {
  const value = normalizeProgressCssValue(valueInput).toLowerCase();
  if (value === "transparent" || value === "none") return true;
  if (/^#[0-9a-f]{3}0$|^#[0-9a-f]{6}00$/i.test(value)) return true;
  const alphaColor = value.match(/^(?:rgba|hsla)\((.*)\)$/i);
  if (!alphaColor) return false;
  const components = splitProgressCssOutsideGroups(alphaColor[1], ",").map((part) => part.trim());
  return components.length === 4 && progressCssValueIsZero(components[3]);
}

function assertWeeklyResultsDividerVisible(
  rules: readonly ProgressCssRule[],
  viewportWidth: number,
) {
  const target = progressCssTargets.weeklyResultsDivider;
  const read = (property: string) => readProgressTargetCssValue({
    rules,
    target,
    property,
    viewportWidth,
  });
  const display = normalizeProgressCssValue(read("display") ?? "").toLowerCase();
  if (display === "none") {
    assert.fail(`UI-NAV-01W: el divisor no puede usar display: none a ${viewportWidth}px`);
  }
  if (!display) {
    assert.fail(`UI-NAV-01W: el divisor debe conservar display ejecutable a ${viewportWidth}px`);
  }

  const visibility = normalizeProgressCssValue(read("visibility") ?? "").toLowerCase();
  if (visibility === "hidden" || visibility === "collapse") {
    assert.fail(`UI-NAV-01W: el divisor no puede usar visibility: ${visibility} a ${viewportWidth}px`);
  }

  const opacity = normalizeProgressCssValue(read("opacity") ?? "").toLowerCase();
  if (opacity && progressCssValueIsZero(opacity)) {
    assert.fail(`UI-NAV-01W: el divisor no puede usar opacity: ${opacity} a ${viewportWidth}px`);
  }

  const content = normalizeProgressCssValue(read("content") ?? "").toLowerCase();
  if (!content || content === "none" || content === "normal") {
    assert.fail(`UI-NAV-01W: el divisor debe conservar content visible a ${viewportWidth}px`);
  }

  const background = normalizeProgressCssValue(read("background-color") ?? "").toLowerCase();
  if (!background || progressCssColorIsTransparent(background)) {
    assert.fail(`UI-NAV-01W: el divisor debe conservar un fondo visible a ${viewportWidth}px`);
  }

  const width = normalizeProgressCssValue(read("width") ?? "").toLowerCase();
  if (!width || progressCssValueIsZero(width)) {
    assert.fail(`UI-NAV-01W: el divisor debe conservar ancho positivo a ${viewportWidth}px`);
  }

  const transform = normalizeProgressCssValue(read("transform") ?? "").toLowerCase();
  if (transformScaleHidesContent(transform)) {
    assert.fail(`UI-NAV-01W: el divisor no puede ocultarse mediante transform: ${transform} a ${viewportWidth}px`);
  }

  const scale = normalizeProgressCssValue(read("scale") ?? "").toLowerCase();
  if (scaleValueHidesContent(scale)) {
    assert.fail(`UI-NAV-01W: el divisor no puede ocultarse mediante scale: ${scale} a ${viewportWidth}px`);
  }

  const clipPath = normalizeProgressCssValue(read("clip-path") ?? "").toLowerCase();
  if (clipPath && clipPath !== "none") {
    assert.fail(`UI-NAV-01W: el divisor no puede usar clip-path: ${clipPath} a ${viewportWidth}px`);
  }
}

function assertWeeklySeriesPillContentVisible(
  rules: readonly ProgressCssRule[],
  viewportWidth: number,
) {
  for (const target of [
    progressCssTargets.weeklySeriesPill,
    progressCssTargets.weeklySeriesPillSpan,
    progressCssTargets.weeklySeriesPillStrong,
  ] as const) {
    const selector = target.label;
    const display = readProgressTargetCssValue({ rules, target, property: "display", viewportWidth });
    if (normalizeProgressCssValue(display ?? "").toLowerCase() === "none") {
      assert.fail(
        `UI-NAV-01V: ${selector} debe permanecer visible a ${viewportWidth}px; display: none oculta el contenido`,
      );
    }

    const visibility = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "visibility", viewportWidth }) ?? "",
    ).toLowerCase();
    if (visibility === "hidden" || visibility === "collapse") {
      assert.fail(
        `UI-NAV-01V: ${selector} debe permanecer visible a ${viewportWidth}px; visibility: ${visibility} oculta el contenido`,
      );
    }

    const opacity = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "opacity", viewportWidth }) ?? "",
    ).toLowerCase();
    if (/^(?:0+(?:\.0+)?|0%)$/.test(opacity)) {
      assert.fail(
        `UI-NAV-01V: ${selector} debe permanecer visible a ${viewportWidth}px; opacity: ${opacity} oculta el contenido`,
      );
    }

    for (const property of ["overflow", "overflow-x", "overflow-y"] as const) {
      const overflow = normalizeProgressCssValue(
        readProgressTargetCssValue({ rules, target, property, viewportWidth }) ?? "",
      ).toLowerCase();
      if (overflow === "hidden" || overflow === "clip") {
        assert.fail(
          `UI-NAV-01V: ${selector} no puede recortar contenido con ${property}: ${overflow} a ${viewportWidth}px`,
        );
      }
    }

    const textOverflow = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "text-overflow", viewportWidth }) ?? "",
    ).toLowerCase();
    if (/(?:^|\s)ellipsis(?:\s|$)/.test(textOverflow)) {
      assert.fail(
        `UI-NAV-01V: ${selector} no puede aplicar text-overflow: ellipsis a ${viewportWidth}px`,
      );
    }

    const contentVisibility = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "content-visibility", viewportWidth }) ?? "",
    ).toLowerCase();
    if (contentVisibility === "hidden") {
      assert.fail(
        `UI-NAV-01V: ${selector} debe mantener content-visibility visible a ${viewportWidth}px`,
      );
    }

    for (const property of ["clip", "clip-path"] as const) {
      const clipping = normalizeProgressCssValue(
        readProgressTargetCssValue({ rules, target, property, viewportWidth }) ?? "",
      ).toLowerCase();
      if (clipping && clipping !== "auto" && clipping !== "none") {
        assert.fail(
          `UI-NAV-01V: ${selector} no puede ocultarse mediante ${property}: ${clipping} a ${viewportWidth}px`,
        );
      }
    }

    const transform = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "transform", viewportWidth }) ?? "",
    ).toLowerCase();
    if (transformScaleHidesContent(transform)) {
      assert.fail(
        `UI-NAV-01V: ${selector} no puede ocultarse mediante transform: ${transform} a ${viewportWidth}px`,
      );
    }

    const scale = normalizeProgressCssValue(
      readProgressTargetCssValue({ rules, target, property: "scale", viewportWidth }) ?? "",
    ).toLowerCase();
    if (scaleValueHidesContent(scale)) {
      assert.fail(
        `UI-NAV-01V: ${selector} no puede ocultarse mediante scale: ${scale} a ${viewportWidth}px`,
      );
    }
  }
}

function readComparisonTableHeaders(source: string) {
  const sourceFile = ts.createSourceFile(
    "comparison-screen-v2.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  assert.equal(diagnostics.length, 0, "UI-NAV-01V: Comparación debe conservar TSX válido");
  const headings: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const className = node.openingElement.attributes.properties.find((property): property is ts.JsxAttribute => (
        ts.isJsxAttribute(property) && property.name.getText() === "className"
      ));
      if (
        className?.initializer &&
        ts.isStringLiteral(className.initializer) &&
        className.initializer.text.split(/\s+/).includes("heading") &&
        className.initializer.text.split(/\s+/).includes("weekly-plan-row")
      ) {
        headings.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(headings.length, 1, "UI-NAV-01V: Comparación debe conservar una cabecera semanal");
  return headings[0].children.flatMap((child) => {
    if (!ts.isJsxElement(child) || child.openingElement.tagName.getText() !== "span") return [];
    return [child.children.filter((item): item is ts.JsxText => ts.isJsxText(item)).map((item) => item.text).join("").trim()];
  });
}

const weeklyResultsBoundaryWidths = [
  319, 320,
  339, 340, 341,
  359, 360,
  392, 393,
  429, 430, 431,
  479, 480, 481, 482, 483,
  519, 520, 521,
  768,
] as const;

const weeklyResultsNormalSeries = {
  label: "S1:",
  value: "100,25 kg · 20 reps",
} as const;

const weeklyResultsExceptionalSeries = [
  { label: "S10:", value: "100,25 kg · 100 reps" },
  { label: "S100:", value: "1000,25 kg · 1000 reps" },
] as const;

function estimateProgressMonoTextWidth(text: string, fontSizePixels: number) {
  return text.length * fontSizePixels * 0.6;
}

function readProgressRequiredTargetValue(input: {
  rules: readonly ProgressCssRule[];
  target: ProgressCssTarget;
  property: string;
  viewportWidth: number;
}) {
  const value = readProgressTargetCssValue(input);
  if (value === null) {
    assert.fail(`UI-NAV-01W CSS: falta ${input.property} efectivo en ${input.target.label} a ${input.viewportWidth}px`);
  }
  return value;
}

function calculateWeeklyResultsGeometry(input: {
  rules: readonly ProgressCssRule[];
  shellRules: readonly ProgressCssRule[];
  viewportWidth: number;
}) {
  const { rules, shellRules, viewportWidth } = input;
  const portalWidth = Math.min(viewportWidth, 560);
  const portalHorizontalPadding = evaluateProgressHorizontalInsets(readProgressCssValue({
    rules: shellRules,
    selector: ".content",
    property: "padding",
    viewportWidth,
  }), viewportWidth);
  const comparisonWidth = portalWidth - portalHorizontalPadding;
  const shellHorizontalBorder = evaluateProgressBorderWidth(readProgressCssValue({
    rules,
    selector: ".weekly-comparison-shell",
    property: "border",
    viewportWidth,
  }), viewportWidth) * 2;
  const shellHorizontalPadding = evaluateProgressHorizontalInsets(readProgressCssValue({
    rules,
    selector: ".weekly-comparison-shell",
    property: "padding",
    viewportWidth,
  }), viewportWidth);
  const resultsCardWidth = comparisonWidth - shellHorizontalBorder - shellHorizontalPadding;
  const resultsCardHorizontalBorder = evaluateProgressBorderWidth(readProgressCssValue({
    rules,
    selector: ".weekly-results-card",
    property: "border",
    viewportWidth,
  }), viewportWidth) * 2;
  const resultsCardHorizontalPadding = evaluateProgressHorizontalInsets(readProgressCssValue({
    rules,
    selector: ".weekly-results-card",
    property: "padding",
    viewportWidth,
  }), viewportWidth);
  const gridWidth = resultsCardWidth - resultsCardHorizontalBorder - resultsCardHorizontalPadding;
  const gridGap = evaluateProgressCssLength(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklyResultsGrid,
    property: "gap",
    viewportWidth,
  }), viewportWidth);
  const columnWidth = (gridWidth - gridGap) / 2;
  const pillHorizontalBorder = evaluateProgressBorderWidth(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklySeriesPill,
    property: "border",
    viewportWidth,
  }), viewportWidth) * 2;
  const pillHorizontalPadding = evaluateProgressHorizontalInsets(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklySeriesPill,
    property: "padding",
    viewportWidth,
  }), viewportWidth);
  const pillGap = evaluateProgressCssLength(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklySeriesPill,
    property: "gap",
    viewportWidth,
  }), viewportWidth);
  const pillContentWidth = columnWidth - pillHorizontalBorder - pillHorizontalPadding;
  const pillFontSizePixels = readProgressInheritedFontSizePixels({
    rules,
    target: progressCssTargets.weeklySeriesPill,
    ancestorTargets: [],
    viewportWidth,
  });
  const normalRequiredWidth = estimateProgressMonoTextWidth(
    weeklyResultsNormalSeries.label + weeklyResultsNormalSeries.value,
    pillFontSizePixels,
  ) + pillGap;

  return {
    viewportWidth,
    portalWidth,
    comparisonWidth,
    resultsCardWidth,
    gridWidth,
    gridGap,
    columnWidth,
    pillContentWidth,
    pillGap,
    pillFontSizePixels,
    normalRequiredWidth,
    normalSlack: pillContentWidth - normalRequiredWidth,
  };
}

function assertWeeklyResultsGeometryAtWidth(
  rules: readonly ProgressCssRule[],
  shellRules: readonly ProgressCssRule[],
  viewportWidth: number,
) {
  const columns = normalizeProgressCssValue(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklyResultsGrid,
    property: "grid-template-columns",
    viewportWidth,
  }));
  if (columns !== "minmax(0,1fr) minmax(0,1fr)") {
    assert.fail(`UI-NAV-01W: Tus resultados debe conservar dos columnas a ${viewportWidth}px`);
  }

  assertWeeklyResultsDividerVisible(rules, viewportWidth);
  assertWeeklySeriesPillContentVisible(rules, viewportWidth);

  const spanWhiteSpace = normalizeProgressCssValue(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklySeriesPillSpan,
    property: "white-space",
    viewportWidth,
  })).toLowerCase();
  if (spanWhiteSpace !== "nowrap") {
    assert.fail(`UI-NAV-01W: la etiqueta de serie debe permanecer completa a ${viewportWidth}px`);
  }

  const strongWhiteSpace = normalizeProgressCssValue(readProgressRequiredTargetValue({
    rules,
    target: progressCssTargets.weeklySeriesPillStrong,
    property: "white-space",
    viewportWidth,
  })).toLowerCase();
  if (strongWhiteSpace !== "normal") {
    assert.fail(`UI-NAV-01W: el valor excepcional debe poder envolver por espacios a ${viewportWidth}px`);
  }
  for (const [property, expected] of [
    ["overflow-wrap", "normal"],
    ["word-break", "normal"],
  ] as const) {
    const actual = normalizeProgressCssValue(readProgressRequiredTargetValue({
      rules,
      target: progressCssTargets.weeklySeriesPillStrong,
      property,
      viewportWidth,
    })).toLowerCase();
    if (actual !== expected) {
      assert.fail(`UI-NAV-01W: el valor debe usar saltos naturales (${property}: ${expected}) a ${viewportWidth}px`);
    }
  }

  const position = normalizeProgressCssValue(readProgressTargetCssValue({
    rules,
    target: progressCssTargets.weeklySeriesPillStrong,
    property: "position",
    viewportWidth,
  }) ?? "static").toLowerCase();
  if (position === "absolute" || position === "fixed") {
    assert.fail(`UI-NAV-01W: el valor no puede superponerse a la etiqueta a ${viewportWidth}px`);
  }
  const marginLeft = normalizeProgressCssValue(readProgressTargetCssValue({
    rules,
    target: progressCssTargets.weeklySeriesPillStrong,
    property: "margin-left",
    viewportWidth,
  }) ?? "0").toLowerCase();
  if (/^-/.test(marginLeft) && evaluateProgressCssLength(marginLeft, viewportWidth) < 0) {
    assert.fail(`UI-NAV-01W: el valor no puede superponerse a la etiqueta a ${viewportWidth}px`);
  }

  const geometry = calculateWeeklyResultsGeometry({ rules, shellRules, viewportWidth });
  for (const [name, value] of [
    ["comparación", geometry.comparisonWidth],
    ["card", geometry.resultsCardWidth],
    ["grilla", geometry.gridWidth],
    ["columna", geometry.columnWidth],
    ["contenido de pill", geometry.pillContentWidth],
  ] as const) {
    if (!(value > 0)) {
      assert.fail(`UI-NAV-01W: ${name} debe conservar ancho positivo a ${viewportWidth}px`);
    }
  }
  if (geometry.gridWidth > geometry.resultsCardWidth || geometry.columnWidth > geometry.gridWidth) {
    assert.fail(`UI-NAV-01W: Tus resultados no puede introducir scroll horizontal a ${viewportWidth}px`);
  }
  if (geometry.pillFontSizePixels < 9) {
    assert.fail(
      `UI-NAV-01W: la pill debe conservar fuente legible a ${viewportWidth}px; ` +
      `fuente efectiva ${geometry.pillFontSizePixels}px`,
    );
  }
  const valueFontSizePixels = readProgressInheritedFontSizePixels({
    rules,
    target: progressCssTargets.weeklySeriesPillStrong,
    ancestorTargets: [progressCssTargets.weeklySeriesPill],
    viewportWidth,
  });
  if (valueFontSizePixels < 9) {
    assert.fail(
      `UI-NAV-01W: el valor de la pill debe conservar fuente legible a ${viewportWidth}px; ` +
      `fuente efectiva ${valueFontSizePixels}px`,
    );
  }
  if (geometry.normalSlack < 0) {
    assert.fail(
      `UI-NAV-01W: S1: 100,25 kg · 20 reps debe caber en una línea a ${viewportWidth}px ` +
      `(holgura ${geometry.normalSlack.toFixed(2)}px)`,
    );
  }

  for (const exceptional of weeklyResultsExceptionalSeries) {
    const labelWidth = estimateProgressMonoTextWidth(exceptional.label, geometry.pillFontSizePixels);
    const valueTrackWidth = geometry.pillContentWidth - labelWidth - geometry.pillGap;
    const longestTokenWidth = Math.max(
      ...exceptional.value.split(/\s+/).map((token) => estimateProgressMonoTextWidth(token, geometry.pillFontSizePixels)),
    );
    if (valueTrackWidth < longestTokenWidth) {
      assert.fail(
        `UI-NAV-01W: ${exceptional.label} ${exceptional.value} debe envolver sin colisión a ${viewportWidth}px`,
      );
    }
  }

  return geometry;
}

function assertWeeklyComparisonResponsiveContract(
  stylesSource: string,
  comparisonComponentSource: string,
  shellStylesSource: string,
  geometryWidths?: readonly number[],
) {
  const rules = parseProgressCss(stylesSource);
  const shellRules = parseProgressCss(shellStylesSource);
  assert.deepEqual(
    readComparisonTableHeaders(comparisonComponentSource),
    ["Ejercicios", "Series", "Reps", "KG"],
    "UI-NAV-01V: Comparación debe conservar Series completo y sin abreviaciones",
  );

  const shellPadding = normalizeProgressCssValue(readProgressCssValue({
    rules: shellRules,
    selector: ".content",
    property: "padding",
    viewportWidth: 320,
  }));
  assert.ok(
    shellPadding.includes("clamp(16px,5vw,24px)"),
    "UI-NAV-01V: el cálculo móvil debe considerar el padding horizontal real del UserPortalShell",
  );
  assert.equal(
    normalizeProgressCssValue(readProgressCssValue({
      rules: shellRules,
      selector: ".shell",
      property: "width",
      viewportWidth: 768,
    })),
    "min(100%,560px)",
    "UI-NAV-01W: el barrido debe derivar el ancho máximo real del UserPortalShell",
  );

  for (const viewportWidth of [320, 360, 393, 430, 431] as const) {
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-comparison-shell",
        property: "padding",
        viewportWidth,
      })),
      viewportWidth <= 430 ? "12px" : "clamp(14px,4vw,18px)",
      `UI-NAV-01V: el shell debe conservar su padding aprobado a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-results-card",
        property: "padding",
        viewportWidth,
      })),
      viewportWidth <= 340 ? "8px 3px" : "8px 5px",
      `UI-NAV-01V: Tus resultados debe conservar padding compacto a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-results-grid",
        property: "gap",
        viewportWidth,
      })),
      viewportWidth <= 340 ? "2px" : "6px",
      `UI-NAV-01V: Tus resultados debe conservar separación compacta a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-series-pill",
        property: "padding",
        viewportWidth,
      })),
      viewportWidth <= 340 ? "4px 1px" : "4px 2px",
      `UI-NAV-01V: las pills deben conservar padding compacto a ${viewportWidth}px`,
    );
    for (const [selector, property, expected] of [
      [".weekly-comparison-screen", "width", "100%"],
      [".weekly-comparison-screen", "min-width", "0"],
      [".weekly-comparison-screen", "max-width", "100%"],
      [".weekly-comparison-shell", "width", "100%"],
      [".weekly-comparison-shell", "min-width", "0"],
      [".weekly-comparison-shell", "max-width", "100%"],
      [".weekly-plan-table", "min-width", "0"],
      [".weekly-plan-table", "max-width", "100%"],
      [".weekly-plan-row", "min-width", "0"],
      [".weekly-plan-row", "max-width", "100%"],
      [".weekly-results-card", "min-width", "0"],
      [".weekly-results-card", "max-width", "100%"],
      [".weekly-results-grid", "min-width", "0"],
      [".weekly-results-grid", "max-width", "100%"],
      [".weekly-series-column", "min-width", "0"],
      [".weekly-series-column", "max-width", "100%"],
      [".weekly-series-pill", "width", "100%"],
      [".weekly-series-pill", "min-width", "0"],
      [".weekly-series-pill", "max-width", "100%"],
    ] as const) {
      const actual = normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector,
        property,
        viewportWidth,
      }));
      if (actual !== expected) {
        assert.fail(`UI-NAV-01V: ${selector} debe conservar ${property}: ${expected} a ${viewportWidth}px`);
      }
    }

    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-plan-row",
        property: "grid-template-columns",
        viewportWidth,
      })),
      "minmax(0,1.5fr) minmax(50px,0.52fr) minmax(50px,0.52fr) minmax(54px,0.5fr)",
      `UI-NAV-01V: Comparación debe reservar la columna mínima aprobada para Series a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-plan-row.heading span",
        property: "white-space",
        viewportWidth,
      })),
      "nowrap",
      `UI-NAV-01V: Series debe permanecer en una línea en Comparación a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-plan-row.heading span",
        property: "overflow-wrap",
        viewportWidth,
      })),
      "normal",
      `UI-NAV-01V: Series no puede partirse internamente en Comparación a ${viewportWidth}px`,
    );
    const seriesFontSizePixels = readProgressInheritedFontSizePixels({
      rules,
      target: progressCssTargets.comparisonHeaderCell,
      ancestorTargets: [progressCssTargets.comparisonHeadingRow],
      viewportWidth,
    });
    if (seriesFontSizePixels < 11) {
      assert.fail(
        `UI-NAV-01V: Series debe conservar una fuente legible en Comparación a ${viewportWidth}px; fuente efectiva ${seriesFontSizePixels}px`,
      );
    }
    const weeklyResultsColumns = normalizeProgressCssValue(readProgressRequiredTargetValue({
      rules,
      target: progressCssTargets.weeklyResultsGrid,
      property: "grid-template-columns",
      viewportWidth,
    }));
    if (weeklyResultsColumns !== "minmax(0,1fr) minmax(0,1fr)") {
      assert.fail(`UI-NAV-01V: Tus resultados debe conservar dos columnas a ${viewportWidth}px`);
    }
    assertWeeklyResultsDividerVisible(rules, viewportWidth);
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-series-column > span",
        property: "text-align",
        viewportWidth,
      })),
      "center",
      `UI-NAV-01V: el título semanal debe permanecer centrado a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-series-column > small",
        property: "text-align",
        viewportWidth,
      })),
      "center",
      `UI-NAV-01V: la fecha semanal debe permanecer centrada a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-series-pill",
        property: "grid-template-columns",
        viewportWidth,
      })),
      "max-content minmax(0,1fr)",
      `UI-NAV-01V: las pills no deben depender de una columna fija a ${viewportWidth}px`,
    );
    assert.equal(
      normalizeProgressCssValue(readProgressTargetCssValue({
        rules,
        target: progressCssTargets.weeklySeriesPillSpan,
        property: "white-space",
        viewportWidth,
      }) ?? ""),
      "nowrap",
      `UI-NAV-01V: la etiqueta de la pill debe permanecer en una línea a ${viewportWidth}px`,
    );
    const valueWhiteSpace = normalizeProgressCssValue(readProgressTargetCssValue({
      rules,
      target: progressCssTargets.weeklySeriesPillStrong,
      property: "white-space",
      viewportWidth,
    }) ?? "");
    if (valueWhiteSpace !== "normal") {
      assert.fail(`UI-NAV-01W: el valor excepcional debe poder envolver por espacios a ${viewportWidth}px`);
    }

    const pillFontSizePixels = readProgressInheritedFontSizePixels({
      rules,
      target: progressCssTargets.weeklySeriesPill,
      ancestorTargets: [],
      viewportWidth,
    });
    if (pillFontSizePixels < 9) {
      assert.fail(
        `UI-NAV-01V: .weekly-series-pill debe conservar una fuente legible a ${viewportWidth}px; fuente efectiva ${pillFontSizePixels}px`,
      );
    }

    const portalPadding = Math.max(16, Math.min(viewportWidth * 0.05, 24));
    const comparisonWidth = viewportWidth - (portalPadding * 2);
    const tableWidth = comparisonWidth - 4 - 24 - 4;
    const fixedColumns = 50 + 50 + 54;
    const gaps = 4 * 3;
    assert.ok(
      tableWidth - fixedColumns - gaps > 0,
      `UI-NAV-01V: la grilla semanal desborda estructuralmente a ${viewportWidth}px`,
    );

    assertWeeklySeriesPillContentVisible(rules, viewportWidth);
  }

  const requestedGeometryWidths = geometryWidths ?? Array.from({ length: 449 }, (_, index) => 320 + index);
  const geometrySweep = requestedGeometryWidths
    .map((viewportWidth) => assertWeeklyResultsGeometryAtWidth(rules, shellRules, viewportWidth));
  const geometry319 = geometryWidths === undefined
    ? assertWeeklyResultsGeometryAtWidth(rules, shellRules, 319)
    : null;
  if (geometry319) {
    const geometryByWidth = new Map<number, ReturnType<typeof calculateWeeklyResultsGeometry>>();
    geometryByWidth.set(319, geometry319);
    for (const geometry of geometrySweep) geometryByWidth.set(geometry.viewportWidth, geometry);
    for (const viewportWidth of weeklyResultsBoundaryWidths) {
      assert.ok(
        geometryByWidth.has(viewportWidth),
        `UI-NAV-01W: falta validar la frontera ${viewportWidth}px`,
      );
    }
  }

  for (const viewportWidth of [768] as const) {
    assert.equal(
      normalizeProgressCssValue(readProgressCssValue({
        rules,
        selector: ".weekly-results-grid",
        property: "grid-template-columns",
        viewportWidth,
      })),
      "minmax(0,1fr) minmax(0,1fr)",
      `UI-NAV-01V: Tus resultados debe conservar dos columnas a ${viewportWidth}px`,
    );
    assertWeeklyResultsDividerVisible(rules, viewportWidth);
    const seriesFontSizePixels = readProgressInheritedFontSizePixels({
      rules,
      target: progressCssTargets.comparisonHeaderCell,
      ancestorTargets: [progressCssTargets.comparisonHeadingRow],
      viewportWidth,
    });
    if (seriesFontSizePixels < 11) {
      assert.fail(
        `UI-NAV-01V: Series debe conservar una fuente legible en Comparación a ${viewportWidth}px; fuente efectiva ${seriesFontSizePixels}px`,
      );
    }
    assertWeeklySeriesPillContentVisible(rules, viewportWidth);
  }


  return {
    geometrySweep,
    geometry319,
    minimumNormalSlack: Math.min(
      ...(geometry319 ? [geometry319.normalSlack] : []),
      ...geometrySweep.map((geometry) => geometry.normalSlack),
    ),
  };
}

const weeklyResultsContractResult = assertWeeklyComparisonResponsiveContract(
  globalStylesSource,
  comparisonSource,
  userPortalShellStylesSource,
);

function replaceProgressProbeOnce(source: string, search: string, replacement: string) {
  assert.equal(source.split(search).length - 1, 1, `UI-NAV-01V probe ambiguo: ${search}`);
  return source.replace(search, replacement);
}

function progressSha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

const weeklyComparisonMutationProbes = [
  {
    name: "hijo directo real con lista media e important oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  .unrelated-pill, body .app-shell .weekly-series-column > .weekly-series-pill {\n    display: none !important;\n  }\n}\n`,
  },
  {
    name: "hermano adyacente real recorta strong",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill strong no puede recortar contenido con overflow: clip a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.app-shell .weekly-series-pill span + strong {\n  overflow: clip;\n}\n`,
  },
  {
    name: "hijo directo real reduce Series en Comparación",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: Series debe conservar una fuente legible en Comparación a 320px; fuente efectiva 1px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.app-shell .weekly-plan-row.heading > span {\n  font-size: 1px;\n}\n`,
  },
  {
    name: "ancestro app-shell oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.app-shell .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "ancestro main.app-shell oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\nmain.app-shell .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "transform scale 0 1 colapsa el eje horizontal",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scale(0,1) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scale(0, 1);\n}\n`,
  },
  {
    name: "transform scale 1 0 colapsa el eje vertical",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scale(1,0) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scale(1, 0);\n}\n`,
  },
  {
    name: "transform scale uniforme colapsa ambos ejes",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scale(0) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scale(0);\n}\n`,
  },
  {
    name: "transform scaleX colapsa el eje horizontal",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scalex(0) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scaleX(0);\n}\n`,
  },
  {
    name: "ancestros body app-shell ocultan por visibility",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; visibility: hidden oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\nbody .app-shell .weekly-series-pill {\n  visibility: hidden;\n}\n`,
  },
  {
    name: "ancestro app-shell recorta strong",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill strong no puede recortar contenido con overflow: clip a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.app-shell .weekly-series-pill strong {\n  overflow: clip;\n}\n`,
  },
  {
    name: "transform scale3d colapsa el eje horizontal",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scale3d(0,1,1) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scale3d(0, 1, 1);\n}\n`,
  },
  {
    name: "transform scale3d colapsa el eje vertical",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scale3d(1,0,1) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: scale3d(1, 0, 1);\n}\n`,
  },
  {
    name: "transformación múltiple colapsa un eje",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: translatex(1px) scale(0,1) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  transform: translateX(1px) scale(0, 1);\n}\n`,
  },
  {
    name: "transform peligroso dentro de media móvil",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante transform: scaley(0%) a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  body .app-shell .weekly-series-pill {\n    transform: scaleY(0%) !important;\n  }\n}\n`,
  },
  {
    name: "ancestro body oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\nbody .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "ancestro Comparación aplica clipping y ellipsis",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede recortar contenido con overflow: hidden a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-comparison-screen .weekly-series-pill {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n`,
  },
  {
    name: "propiedad individual scale oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante scale: 0 a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: 0;\n}\n`,
  },
  {
    name: "ancestros html body ocultan la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\nhtml body .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "ancestro adicional recorta el contenido strong",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill strong no puede recortar contenido con overflow: hidden a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-comparison-screen .weekly-series-pill strong {\n  overflow: hidden;\n}\n`,
  },
  {
    name: "scale 0 1 colapsa un eje",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante scale: 0 1 a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: 0 1;\n}\n`,
  },
  {
    name: "scale 1 0 colapsa un eje",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante scale: 1 0 a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: 1 0;\n}\n`,
  },
  {
    name: "scale porcentual cero oculta la pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante scale: 0% a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: 0%;\n}\n`,
  },
  {
    name: "regla peligrosa móvil dentro de lista de selectores",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  .unrelated-card, body .weekly-series-pill {\n    display: none !important;\n  }\n}\n`,
  },
  {
    name: "scale porcentual de dos ejes dentro de media con important",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede ocultarse mediante scale: 0% 100% a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  html body .weekly-series-pill {\n    scale: 0% 100% !important;\n  }\n}\n`,
  },
  {
    name: "aplicar clipping y ellipsis a las pills",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill no puede recortar contenido con overflow: hidden a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n`,
  },
  {
    name: "ocultar completamente las pills",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; display: none oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "reducir Series a 1px en Comparación",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: Series debe conservar una fuente legible en Comparación a 320px; fuente efectiva 1px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-plan-row.heading span {\n  font-size: 1px;\n}\n`,
  },
  {
    name: "permitir wrap de Series",
    target: "css" as const,
    expectedFailure: "Series debe permanecer en una línea en Comparación a 320px",
    exactFailure: false,
    mutate: (source: string) => replaceProgressProbeOnce(source, "white-space: nowrap;\n}\n\n.weekly-plan-row:not(.heading)", "white-space: normal;\n}\n\n.weekly-plan-row:not(.heading)"),
  },
  {
    name: "restaurar apilado móvil rechazado",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: Tus resultados debe conservar dos columnas a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  .weekly-results-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`,
  },
  {
    name: "ocultar el divisor central móvil",
    target: "css" as const,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar display: none a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 430px) {\n  .weekly-results-grid::before {\n    display: none !important;\n  }\n}\n`,
  },
  {
    name: "recortar y aplicar ellipsis al valor de una pill",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill strong no puede recortar contenido con overflow: hidden a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill strong {\n  overflow: hidden !important;\n  text-overflow: ellipsis !important;\n}\n`,
  },
  {
    name: "ocultar una pill mediante visibility",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe permanecer visible a 320px; visibility: hidden oculta el contenido",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  visibility: hidden !important;\n}\n`,
  },
  {
    name: "reducir la fuente de las pills a 1px",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe conservar una fuente legible a 320px; fuente efectiva 1px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  font-size: 1px !important;\n}\n`,
  },
  {
    name: "introducir ancho fijo incompatible en las pills",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill debe conservar width: 100% a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  width: 200px !important;\n}\n`,
  },
  {
    name: "reducir la primera columna semanal a cero",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: Tus resultados debe conservar dos columnas a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n.weekly-results-grid {\n  grid-template-columns: minmax(0, 0fr) minmax(0, 1fr) !important;\n}\n`,
  },
  {
    name: "romper exclusivamente el límite de 320px",
    target: "css" as const,
    expectedFailure: "UI-NAV-01V: Tus resultados debe conservar dos columnas a 320px",
    exactFailure: true,
    mutate: (source: string) => `${source}\n@media (max-width: 320px) {\n  .weekly-results-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`,
  },
  {
    name: "eliminar límite de ancho de pill",
    target: "css" as const,
    expectedFailure: ".weekly-series-pill debe conservar max-width: 100% a 320px",
    exactFailure: false,
    mutate: (source: string) => replaceProgressProbeOnce(source, "width: 100%;\n  max-width: 100%;\n  grid-template-columns: max-content", "width: 100%;\n  max-width: none;\n  grid-template-columns: max-content"),
  },
  {
    name: "restaurar columna fija incompatible en pill",
    target: "css" as const,
    expectedFailure: "las pills no deben depender de una columna fija a 320px",
    exactFailure: false,
    mutate: (source: string) => replaceProgressProbeOnce(source, "grid-template-columns: max-content minmax(0, 1fr);", "grid-template-columns: 90px minmax(0, 1fr);"),
  },
  {
    name: "forzar overflow horizontal móvil",
    target: "css" as const,
    expectedFailure: ".weekly-comparison-screen debe conservar width: 100% a 320px",
    exactFailure: false,
    mutate: (source: string) => replaceProgressProbeOnce(source, ".weekly-comparison-screen {\n  grid-template-columns: minmax(0, 1fr);\n  width: 100%;", ".weekly-comparison-screen {\n  grid-template-columns: minmax(0, 1fr);\n  width: 120vw;"),
  },
  {
    name: "abreviar Series en Comparación",
    target: "tsx" as const,
    expectedFailure: "Comparación debe conservar Series completo y sin abreviaciones",
    exactFailure: false,
    mutate: (source: string) => replaceProgressProbeOnce(source, ">Series</span>", ">Serie</span>"),
  },
] as const;

for (const probe of weeklyComparisonMutationProbes) {
  const diskPath = probe.target === "css"
    ? "src/app/globals.css"
    : "src/features/progress/components/comparison-screen-v2.tsx";
  const originalSource = probe.target === "css" ? globalStylesSource : comparisonSource;
  const originalDiskSource = readFileSync(diskPath, "utf8");
  const originalDiskHash = progressSha256(originalDiskSource);
  assert.equal(
    originalDiskSource,
    originalSource,
    `UI-NAV-01V: el source base debe coincidir byte a byte con disco (${probe.name})`,
  );
  const mutatedSource = probe.mutate(originalSource);
  assert.notEqual(mutatedSource, originalSource, `UI-NAV-01V: mutación sin cambio real (${probe.name})`);
  assert.notEqual(
    progressSha256(mutatedSource),
    originalDiskHash,
    `UI-NAV-01V: mutación sin cambio SHA (${probe.name})`,
  );
  const mutatedCss = probe.target === "css" ? mutatedSource : globalStylesSource;
  const mutatedTsx = probe.target === "tsx" ? mutatedSource : comparisonSource;
  if (probe.target === "css") parseProgressCss(mutatedSource);
  else readComparisonTableHeaders(mutatedSource);
  let failure: unknown;
  try {
    assertWeeklyComparisonResponsiveContract(mutatedCss, mutatedTsx, userPortalShellStylesSource, [320]);
  } catch (error) {
    failure = error;
  } finally {
    const restoredDiskSource = readFileSync(diskPath, "utf8");
    assert.equal(
      restoredDiskSource,
      originalDiskSource,
      `UI-NAV-01V: restauración byte a byte fallida (${probe.name})`,
    );
    assert.equal(
      progressSha256(restoredDiskSource),
      originalDiskHash,
      `UI-NAV-01V: restauración SHA fallida (${probe.name})`,
    );
  }
  assert.ok(failure instanceof Error, `UI-NAV-01V: el mutante debe morir (${probe.name})`);
  if (probe.exactFailure) {
    assert.equal(
      failure.message,
      probe.expectedFailure,
      `UI-NAV-01V: el mutante debe morir primero por su barrera exacta (${probe.name})`,
    );
  } else {
    assert.ok(
      failure.message.includes(probe.expectedFailure),
      `UI-NAV-01V: el mutante debe morir por su barrera semántica (${probe.name})`,
    );
  }
}

const weeklyComparisonInnocentControls = [
  {
    name: "comentario CSS dentro de copia mutada",
    mutate: (source: string) => `${source}\n/* UI-NAV-01V: pill visible y legible */\n`,
  },
  {
    name: "reformateo",
    mutate: (source: string) => replaceProgressProbeOnce(
      source,
      ".weekly-series-pill {\n  display: grid;",
      ".weekly-series-pill\n{\n  display: grid;",
    ),
  },
  {
    name: "reordenamiento inocente de declaraciones",
    mutate: (source: string) => replaceProgressProbeOnce(
      source,
      "  display: grid;\n  width: 100%;\n  max-width: 100%;\n  grid-template-columns: max-content minmax(0, 1fr);",
      "  max-width: 100%;\n  width: 100%;\n  display: grid;\n  grid-template-columns: max-content minmax(0, 1fr);",
    ),
  },
  {
    name: "declaraciones equivalentes visibles y legibles",
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  display: inline-grid;\n  overflow: visible;\n  opacity: 1;\n}\n.weekly-plan-row.heading span {\n  font-size: 1rem;\n}\n`,
  },
  {
    name: "ancestros adicionales con contenido visible",
    mutate: (source: string) => `${source}\nhtml body .app-shell .weekly-comparison-screen .weekly-series-pill {\n  display: grid;\n  overflow: visible;\n  opacity: 1;\n}\n`,
  },
  {
    name: "scale unitario visible",
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: 1;\n}\n`,
  },
  {
    name: "scale none visible",
    mutate: (source: string) => `${source}\n.weekly-series-pill {\n  scale: none;\n}\n`,
  },
  {
    name: "selector no relacionado oculto",
    mutate: (source: string) => `${source}\n.unrelated-card .unrelated-pill {\n  display: none;\n}\n`,
  },
  {
    name: "scale peligroso anulado por mayor prioridad",
    mutate: (source: string) => `${source}\nbody .weekly-series-pill {\n  scale: 0;\n}\n.weekly-series-pill.weekly-series-pill {\n  scale: 1 !important;\n}\n`,
  },
  {
    name: "transform scale unitario visible",
    mutate: (source: string) => `${source}\n.app-shell .weekly-series-pill {\n  transform: scale(1, 1);\n}\n`,
  },
  {
    name: "transform scale3d unitario visible",
    mutate: (source: string) => `${source}\nmain.app-shell .weekly-series-pill {\n  transform: scale3d(1, 1, 1);\n}\n`,
  },
  {
    name: "transform no relacionado peligroso",
    mutate: (source: string) => `${source}\n.unrelated-card .unrelated-pill {\n  transform: scale(0, 1);\n}\n`,
  },
  {
    name: "transform peligroso anulado por mayor prioridad",
    mutate: (source: string) => `${source}\n.app-shell .weekly-series-pill {\n  transform: scale(0, 1);\n}\n.weekly-series-pill.weekly-series-pill {\n  transform: scale(1, 1) !important;\n}\n`,
  },
  {
    name: "weekly-results-grid no es padre directo de la pill",
    mutate: (source: string) => `${source}\n.weekly-results-grid > .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "app-shell no es padre directo de la pill",
    mutate: (source: string) => `${source}\nmain.app-shell > .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "weekly-series-column no es hermano adyacente de la pill",
    mutate: (source: string) => `${source}\n.weekly-series-column + .weekly-series-pill {\n  display: none;\n}\n`,
  },
  {
    name: "weekly-series-column no es hermano general de la pill",
    mutate: (source: string) => `${source}\n.weekly-series-column ~ .weekly-series-pill {\n  visibility: hidden;\n}\n`,
  },
  {
    name: "weekly-plan-table no es padre directo de heading",
    mutate: (source: string) => `${source}\n.weekly-plan-table > .weekly-plan-row.heading > span {\n  font-size: 1px;\n}\n`,
  },
] as const;

for (const control of weeklyComparisonInnocentControls) {
  const controlledCss = control.mutate(globalStylesSource);
  assert.notEqual(
    progressSha256(controlledCss),
    progressSha256(globalStylesSource),
    `UI-NAV-01V: control inocente sin cambio real (${control.name})`,
  );
  parseProgressCss(controlledCss);
  assertWeeklyComparisonResponsiveContract(
    controlledCss,
    comparisonSource,
    userPortalShellStylesSource,
    [320],
  );
}

const weeklyResultsGeometryMutationProbes = [
  {
    name: "restaurar discontinuidad 480/481",
    attackWidth: 481,
    expectedFailure: "UI-NAV-01W: S1: 100,25 kg · 20 reps debe caber en una línea a 481px (holgura -7.90px)",
    mutate: (source: string) => replaceProgressProbeOnce(
      source,
      "@media (max-width: 520px) {\n  .weekly-results-card",
      "@media (max-width: 480px) {\n  .weekly-results-card",
    ),
  },
  {
    name: "romper únicamente 481 y 482",
    attackWidth: 481,
    expectedFailure: "UI-NAV-01W: Tus resultados debe conservar dos columnas a 481px",
    mutate: (source: string) => `${source}\n@media (min-width: 481px) and (max-width: 482px) {\n  .weekly-results-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`,
  },
  {
    name: "romper únicamente la frontera 340/341",
    attackWidth: 341,
    expectedFailure: "UI-NAV-01W: Tus resultados debe conservar dos columnas a 341px",
    mutate: (source: string) => `${source}\n@media (min-width: 341px) and (max-width: 341px) {\n  .weekly-results-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`,
  },
  {
    name: "forzar nowrap en valores excepcionales",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el valor excepcional debe poder envolver por espacios a 320px",
    mutate: (source: string) => `${source}\n.weekly-series-pill strong {\n  white-space: nowrap !important;\n}\n`,
  },
  {
    name: "superponer el valor sobre S1",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el valor no puede superponerse a la etiqueta a 320px",
    mutate: (source: string) => `${source}\n.weekly-series-pill strong {\n  margin-left: -12px !important;\n}\n`,
  },
  {
    name: "recortar el valor excepcional",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01V: .weekly-series-pill strong no puede recortar contenido con overflow: hidden a 320px",
    mutate: (source: string) => `${source}\n.weekly-series-pill strong {\n  overflow: hidden !important;\n  text-overflow: ellipsis !important;\n}\n`,
  },
  {
    name: "reducir sólo el valor a 1px",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el valor de la pill debe conservar fuente legible a 320px; fuente efectiva 1px",
    mutate: (source: string) => `${source}\n.weekly-series-pill strong {\n  font-size: 1px !important;\n}\n`,
  },
  {
    name: "apilar semanas ante contenido largo",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01V: Tus resultados debe conservar dos columnas a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid.weekly-results-grid {\n  grid-template-columns: minmax(0, 1fr) !important;\n}\n`,
  },
  {
    name: "divisor display none con mayor especificidad",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar display: none a 320px",
    mutate: (source: string) => `${source}\nbody .weekly-results-grid.weekly-results-grid::before {\n  display: none !important;\n}\n`,
  },
  {
    name: "divisor visibility hidden",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar visibility: hidden a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  visibility: hidden !important;\n}\n`,
  },
  {
    name: "divisor visibility collapse",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar visibility: collapse a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  visibility: collapse !important;\n}\n`,
  },
  {
    name: "divisor opacity cero",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar opacity: 0 a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  opacity: 0 !important;\n}\n`,
  },
  {
    name: "divisor content none",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor debe conservar content visible a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  content: none !important;\n}\n`,
  },
  {
    name: "divisor background transparente",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor debe conservar un fondo visible a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  background: transparent !important;\n}\n`,
  },
  {
    name: "divisor ancho cero",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor debe conservar ancho positivo a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  width: 0 !important;\n}\n`,
  },
  {
    name: "divisor transform scale cero",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede ocultarse mediante transform: scale(0) a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  transform: scale(0) !important;\n}\n`,
  },
  {
    name: "divisor propiedad scale cero",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede ocultarse mediante scale: 0 a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  scale: 0 !important;\n}\n`,
  },
  {
    name: "divisor clip-path",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar clip-path: inset(50%) a 320px",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  clip-path: inset(50%) !important;\n}\n`,
  },
  {
    name: "divisor oculto dentro de media query",
    attackWidth: 430,
    expectedFailure: "UI-NAV-01W: el divisor no puede usar opacity: 0 a 430px",
    mutate: (source: string) => `${source}\n@media (min-width: 430px) and (max-width: 430px) {\n  main.app-shell .weekly-results-grid::before {\n    opacity: 0 !important;\n  }\n}\n`,
  },
  {
    name: "romper ancho intermedio 607 no listado",
    attackWidth: 607,
    expectedFailure: "UI-NAV-01W: Tus resultados debe conservar dos columnas a 607px",
    mutate: (source: string) => `${source}\n@media (min-width: 607px) and (max-width: 607px) {\n  .weekly-results-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`,
  },
  {
    name: "introducir scroll horizontal",
    attackWidth: 320,
    expectedFailure: "UI-NAV-01V: .weekly-comparison-screen debe conservar width: 100% a 320px",
    mutate: (source: string) => `${source}\n.weekly-comparison-screen {\n  width: 120vw !important;\n}\n`,
  },
] as const;

for (const probe of weeklyResultsGeometryMutationProbes) {
  const diskPath = "src/app/globals.css";
  const originalDiskSource = readFileSync(diskPath, "utf8");
  const originalDiskHash = progressSha256(originalDiskSource);
  assert.equal(
    originalDiskSource,
    globalStylesSource,
    `UI-NAV-01W: el CSS base debe coincidir byte a byte con disco (${probe.name})`,
  );
  const mutatedCss = probe.mutate(globalStylesSource);
  assert.notEqual(mutatedCss, globalStylesSource, `UI-NAV-01W: mutación sin cambio real (${probe.name})`);
  assert.notEqual(
    progressSha256(mutatedCss),
    originalDiskHash,
    `UI-NAV-01W: mutación sin cambio SHA (${probe.name})`,
  );
  parseProgressCss(mutatedCss);
  let failure: unknown;
  try {
    assertWeeklyComparisonResponsiveContract(
      mutatedCss,
      comparisonSource,
      userPortalShellStylesSource,
      [probe.attackWidth],
    );
  } catch (error) {
    failure = error;
  } finally {
    const restoredDiskSource = readFileSync(diskPath, "utf8");
    assert.equal(
      restoredDiskSource,
      originalDiskSource,
      `UI-NAV-01W: restauración byte a byte fallida (${probe.name})`,
    );
    assert.equal(
      progressSha256(restoredDiskSource),
      originalDiskHash,
      `UI-NAV-01W: restauración SHA fallida (${probe.name})`,
    );
  }
  assert.ok(failure instanceof Error, `UI-NAV-01W: el mutante debe morir (${probe.name})`);
  assert.equal(
    failure.message,
    probe.expectedFailure,
    `UI-NAV-01W: el mutante debe morir primero por su barrera exacta (${probe.name})`,
  );
}

const weeklyResultsGeometryInnocentControls = [
  {
    name: "comentario inocente",
    mutate: (source: string) => `${source}\n/* UI-NAV-01W: dos columnas y divisor visible */\n`,
  },
  {
    name: "formato equivalente del media compacto",
    mutate: (source: string) => replaceProgressProbeOnce(
      source,
      "@media (max-width: 520px) {\n  .weekly-results-card",
      "@media (max-width: 520px)\n{\n  .weekly-results-card",
    ),
  },
  {
    name: "reordenamiento equivalente del valor",
    mutate: (source: string) => replaceProgressProbeOnce(
      source,
      "  overflow-wrap: normal;\n  word-break: normal;\n  white-space: normal;",
      "  white-space: normal;\n  overflow-wrap: normal;\n  word-break: normal;",
    ),
  },
  {
    name: "override seguro del divisor con mayor prioridad",
    mutate: (source: string) => `${source}\nbody .weekly-results-grid.weekly-results-grid::before {\n  display: block !important;\n  visibility: visible !important;\n  opacity: 1 !important;\n  content: "" !important;\n  background: rgba(255, 255, 255, 0.78) !important;\n  width: 1px !important;\n  transform: scale(1) !important;\n  scale: 1 !important;\n  clip-path: none !important;\n}\n`,
  },
  {
    name: "regla no relacionada invisible",
    mutate: (source: string) => `${source}\n.unrelated-results-grid::before {\n  display: none;\n  opacity: 0;\n  width: 0;\n}\n`,
  },
  {
    name: "wrap natural limitado al rango estrecho",
    mutate: (source: string) => `${source}\n@media (max-width: 340px) {\n  .weekly-series-pill strong {\n    overflow-wrap: normal;\n    word-break: normal;\n    white-space: normal;\n  }\n}\n`,
  },
  {
    name: "regla peligrosa anulada por cascada prioritaria",
    mutate: (source: string) => `${source}\n.weekly-results-grid::before {\n  opacity: 0;\n}\nbody .weekly-results-grid::before {\n  opacity: 1 !important;\n}\n`,
  },
] as const;

for (const control of weeklyResultsGeometryInnocentControls) {
  const controlledCss = control.mutate(globalStylesSource);
  assert.notEqual(
    progressSha256(controlledCss),
    progressSha256(globalStylesSource),
    `UI-NAV-01W: control inocente sin cambio real (${control.name})`,
  );
  parseProgressCss(controlledCss);
  assertWeeklyComparisonResponsiveContract(
    controlledCss,
    comparisonSource,
    userPortalShellStylesSource,
    [320, 481, 520, 521, 768],
  );
}

console.log(`UI-NAV-01V Progress mutation probes passed (${weeklyComparisonMutationProbes.length})`);
console.log(`UI-NAV-01V Progress innocent controls passed (${weeklyComparisonInnocentControls.length})`);
console.log(`UI-NAV-01W geometry/divider mutation probes passed (${weeklyResultsGeometryMutationProbes.length})`);
console.log(`UI-NAV-01W geometry/divider innocent controls passed (${weeklyResultsGeometryInnocentControls.length})`);
console.log(
  `UI-NAV-01W geometry sweep passed (320-768: ${weeklyResultsContractResult.geometrySweep.length} widths; ` +
  `319px boundary; minimum normal slack ${weeklyResultsContractResult.minimumNormalSlack.toFixed(2)}px)`,
);

console.log("progress visual static integration contract tests passed");
