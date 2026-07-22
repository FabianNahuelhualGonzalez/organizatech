import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Estos tests verifican el contrato de los componentes de H1-C mediante lectura
 * directa del código fuente (mismo patrón ya usado en el repo, ej.
 * workout-draft-storage.test.ts). No se usa renderToStaticMarkup aquí porque se
 * confirmó empíricamente que `tsx` no puede resolver imports de `*.module.css`
 * fuera del pipeline de Next.js: cualquier intento de importar un componente que
 * transitivamente importe un CSS Module falla con
 * "SyntaxError: Unexpected token '.'" al ejecutar el archivo de test directo.
 */

const screenSource = readFileSync("src/components/training/cycle-history/CycleHistoryScreen.tsx", "utf8");
const listSource = readFileSync("src/components/training/cycle-history/CycleHistoryList.tsx", "utf8");
const cardSource = readFileSync("src/components/training/cycle-history/CycleHistoryCard.tsx", "utf8");
const statesSource = readFileSync("src/components/training/cycle-history/CycleHistoryStates.tsx", "utf8");
const summarySource = readFileSync("src/components/training/cycle-history/CycleHistorySummary.tsx", "utf8");
const breakdownSource = readFileSync("src/components/training/cycle-history/CycleHistoryRoutineBreakdown.tsx", "utf8");
const cssSource = readFileSync("src/components/training/cycle-history/cycle-history.module.css", "utf8");
const qaFixturesSource = readFileSync("src/app/qa/training-cycle-history/training-cycle-history-qa-fixtures.ts", "utf8");
const qaClientSource = readFileSync("src/app/qa/training-cycle-history/training-cycle-history-qa-client.tsx", "utf8");
const qaPageSource = readFileSync("src/app/qa/training-cycle-history/page.tsx", "utf8");

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

// 4. Estado idle.
function testScreenHandlesIdleState() {
  assert.match(screenSource, /case "idle":\s*\n\s*return <CycleHistoryIdleState \/>;/);
}

// 5. Estado disabled.
function testScreenHandlesDisabledState() {
  assert.match(screenSource, /case "disabled":\s*\n\s*return <CycleHistoryDisabledState \/>;/);
}

// 6. Estado loading.
function testScreenHandlesLoadingState() {
  assert.match(screenSource, /case "loading":\s*\n\s*return <CycleHistoryLoadingState label="Cargando historial de ciclos…" \/>;/);
  assert.match(
    statesSource,
    /<div className={styles\.stateLoading} role="status" aria-live="polite">/,
    "el estado loading debe anunciarse con role=status/aria-live, sin cambios bruscos de layout (skeleton)",
  );
  assert.match(statesSource, /skeletonLine/);
}

// 7. Estado empty.
function testScreenHandlesEmptyState() {
  assert.match(screenSource, /case "empty":\s*\n\s*return <CycleHistoryEmptyState message={EMPTY_CYCLES_MESSAGE} \/>;/);
}

// 8. Estado error con mensaje sanitizado (nunca detalles tecnicos crudos).
function testScreenHandlesErrorStateWithSanitizedMessage() {
  assert.match(screenSource, /case "error":\s*\n\s*return <CycleHistoryErrorState message={listState\.error\.message} \/>;/);
  assert.match(statesSource, /<div className={styles\.stateError} role="alert">/);
  assert.doesNotMatch(statesSource, /stack|Supabase|postgres|PGRST|23505/i);
}

// 9. Estado ready.
function testScreenHandlesReadyState() {
  assert.match(screenSource, /case "ready": {/);
  assert.match(screenSource, /buildCycleHistoryListViewModels\(listState\.cycles\)/);
  assert.match(screenSource, /<CycleHistoryList/);
}

// El vaciamiento de un detalle vacio se distingue de un error (estados separados).
function testEmptyDetailIsDistinctFromError() {
  assert.match(cardSource, /case "empty":\s*\n\s*return <CycleHistoryEmptyState message="Este ciclo todavía no tiene semanas registradas\." \/>;/);
  assert.match(cardSource, /case "error":\s*\n\s*return \(/);
}

// 10. Ciclo expandido correcto: solo la tarjeta con expandedCycleId === cycle.cycleId recibe el detailState real.
function testOnlyExpandedCardReceivesRealDetailState() {
  assert.match(listSource, /const isExpanded = expandedCycleId === cycle\.cycleId;/);
  assert.match(listSource, /detailState={isExpanded \? detailState : IDLE_DETAIL_STATE}/);
}

// 13. Callback de retry con cycleId correcto.
function testRetryCallbackReceivesCorrectCycleId() {
  assert.match(listSource, /onRetry={\(\) => onRetry\(cycle\.cycleId\)}/);
}

// 14. Callback PDF con cycleId correcto.
function testDownloadPdfCallbackReceivesCorrectCycleId() {
  assert.match(listSource, /onDownloadPdf={\(\) => onDownloadPdf\(cycle\.cycleId\)}/);
}

// onToggleCycle tambien recibe el cycleId correcto (mismo patron).
function testToggleCallbackReceivesCorrectCycleId() {
  assert.match(listSource, /onToggle={\(\) => onToggleCycle\(cycle\.cycleId\)}/);
}

// 15 (markup). El boton PDF usa la funcion pura de deshabilitado, nunca un booleano manual.
function testPdfButtonUsesPureDisabledLogic() {
  assert.match(cardSource, /disabled={isCycleHistoryPdfActionDisabled\(detailState\.status, isPdfActionBusy\)}/);
}

// 18. IDs estables y aria-expanded/aria-controls correctos, construidos via helpers seguros (H1-C.1).
function testStableIdsAndAriaAttributes() {
  assert.match(cardSource, /const detailId = buildCycleHistoryDetailDomId\(cycle\.cycleId\);/);
  assert.match(cardSource, /const headingId = buildCycleHistoryHeadingDomId\(cycle\.cycleId\);/);
  assert.match(cardSource, /aria-expanded={isExpanded}/);
  assert.match(cardSource, /aria-controls={detailId}/);
  assert.match(cardSource, /id={headingId}/);
  assert.match(cardSource, /<div id={detailId} role="region" aria-labelledby={headingId}/);
}

// Botones reales, no divs clickeables: cada onClick debe estar en un <button type="button">.
function testEveryInteractiveElementIsARealButton() {
  for (const source of [cardSource, statesSource]) {
    const onClickCount = countMatches(source, /onClick={/);
    const typeButtonCount = countMatches(source, /type="button"/);
    assert.ok(
      typeButtonCount >= onClickCount,
      "cada onClick debe corresponder a un <button type=\"button\">, nunca a un div clickeable",
    );
  }
  assert.doesNotMatch(cardSource, /<div[^>]*onClick=/);
  assert.doesNotMatch(statesSource, /<div[^>]*onClick=/);
}

// Iconos acompañados de texto o aria-hidden (ChevronDown/Download/AlertTriangle/RefreshCw nunca solos sin texto).
function testIconsAreAccompaniedByTextOrAriaHidden() {
  assert.match(cardSource, /<ChevronDown[\s\S]*?aria-hidden="true"/);
  assert.match(cardSource, /<Download[\s\S]*?aria-hidden="true"/);
  assert.match(statesSource, /<AlertTriangle[\s\S]*?aria-hidden="true"/);
  assert.match(statesSource, /<RefreshCw[\s\S]*?aria-hidden="true"/);
}

// Encabezados jerarquicos: h1 en la pantalla, h2/h3 en el detalle.
function testHeadingHierarchy() {
  assert.match(screenSource, /<h1 className={styles\.title}>/);
  assert.match(breakdownSource, /<h2 className={styles\.routineName}>/);
  assert.match(breakdownSource, /<h3 className={styles\.exerciseName}>/);
}

// 19. Render responsive estructural: la tabla semanal permite scroll horizontal controlado
// y el CSS module define un breakpoint mobile explicito, sin ancho fijo que rompa pantallas chicas.
function testResponsiveStructuralRules() {
  assert.match(breakdownSource, /className={styles\.weekTableWrapper}/);
  assert.match(cssSource, /\.weekTableWrapper {\s*\n\s*max-width: 100%;\s*\n\s*overflow-x: auto;/);
  assert.match(cssSource, /@media \(max-width: 520px\) {/);
  assert.doesNotMatch(
    cssSource,
    /(?<!min-|max-)\bwidth:\s*(?!1px;)\d+px;/,
    "no debe usarse un ancho fijo (width, sin min-/max-) en px que rompa pantallas pequeñas" +
      " (se excluye el 1px de .visuallyHidden, patrón estándar de accesibilidad, no de layout)",
  );
}

// No renderizar directamente objetos mutables: CycleHistorySummary/RoutineBreakdown solo reciben el view model, no breakdown/metrics crudos.
function testComponentsOnlyConsumeViewModelTypes() {
  assert.match(summarySource, /detail: CycleHistoryDetailViewModel/);
  assert.doesNotMatch(summarySource, /CycleHistoryBreakdown|CycleHistoryMetricsSummary/);
  assert.match(breakdownSource, /detail: CycleHistoryDetailViewModel/);
  assert.doesNotMatch(breakdownSource, /CycleHistoryBreakdown\b/);
}

// 20. Fixtures QA: sin PII real, sin Supabase, sin repositorios, sin data source.
function assertNoRealDataSourceImports(source: string) {
  // Se valida contra imports/uso real (from "...supabase...", "...-repository"),
  // no contra la palabra "Supabase" en comentarios que aclaran que NO se usa.
  assert.doesNotMatch(source, /from\s+["'][^"']*supabase[^"']*["']/i);
  assert.doesNotMatch(source, /from\s+["'][^"']*-repository["']/i);
  assert.doesNotMatch(source, /cycle-history-data-source/);
}

function testQaFixturesHaveNoRealQueriesOrPii() {
  assertNoRealDataSourceImports(qaFixturesSource);
  assert.match(qaFixturesSource, /firstName: "QA"/);
  assert.match(qaFixturesSource, /lastName: "Fixture"/);
  assert.doesNotMatch(qaFixturesSource, /@gmail\.|@hotmail\.|nahuelhual/i);

  assertNoRealDataSourceImports(qaClientSource);
}

// H1-C.1 — Cleanup de timers en el cliente QA: ids guardados en useRef, cancelados en
// el cleanup de useEffect al desmontar, reemplazados antes de programar uno nuevo
// (evita residuales al cambiar rápidamente de ciclo), y sin setState tras el unmount.
function testQaClientCleansUpTimersOnUnmount() {
  assert.match(qaClientSource, /const detailTimerRef = useRef<number \| null>\(null\);/);
  assert.match(qaClientSource, /const pdfTimerRef = useRef<number \| null>\(null\);/);
  assert.match(qaClientSource, /const isMountedRef = useRef\(true\);/);

  assert.match(
    qaClientSource,
    /useEffect\(\(\) => \{\s*return \(\) => \{\s*isMountedRef\.current = false;\s*clearScheduledTimer\(detailTimerRef\);\s*clearScheduledTimer\(pdfTimerRef\);\s*\};\s*\}, \[\]\);/,
    "el cleanup de useEffect debe marcar isMountedRef en false y cancelar ambos timers al desmontar",
  );

  assert.match(
    qaClientSource,
    /function scheduleTimer\(ref: TimerRef, delay: number, callback: \(\) => void\) \{\s*clearScheduledTimer\(ref\);/,
    "scheduleTimer debe cancelar cualquier timer previo antes de programar uno nuevo",
  );

  assert.match(qaClientSource, /scheduleTimer\(detailTimerRef, 400, \(\) => \{\s*if \(!isMountedRef\.current\) return;/);
  assert.match(qaClientSource, /scheduleTimer\(pdfTimerRef, 600, \(\) => \{\s*if \(!isMountedRef\.current\) return;/);
}

// Los callbacks siguen recibiendo el cycleId original real, no una version normalizada.
function testTimerCallbacksStillReceiveOriginalCycleId() {
  assert.match(qaClientSource, /function loadDetail\(cycleId: string\) \{/);
  assert.match(qaClientSource, /setDetailState\(\{ status: "loading", cycleId \}\);/);
  assert.match(qaClientSource, /setDetailState\(\{ status: "error", cycleId, error: QA_SIMULATED_ERROR \}\);/);
  assert.match(qaClientSource, /function handleDownloadPdf\(cycleId: string\) \{/);
  assert.match(qaClientSource, /setLastPdfCallback\(cycleId\);/);
}

// La ruta QA reutiliza la politica QA existente, igual que las demas herramientas QA.
function testQaRouteReusesExistingAccessPolicy() {
  assert.match(qaPageSource, /isQaToolsAccessAllowed/);
  assert.match(qaPageSource, /notFound\(\)/);
  assert.match(qaPageSource, /export const dynamic = "force-dynamic";/);
}

testScreenHandlesIdleState();
testScreenHandlesDisabledState();
testScreenHandlesLoadingState();
testScreenHandlesEmptyState();
testScreenHandlesErrorStateWithSanitizedMessage();
testScreenHandlesReadyState();
testEmptyDetailIsDistinctFromError();
testOnlyExpandedCardReceivesRealDetailState();
testRetryCallbackReceivesCorrectCycleId();
testDownloadPdfCallbackReceivesCorrectCycleId();
testToggleCallbackReceivesCorrectCycleId();
testPdfButtonUsesPureDisabledLogic();
testStableIdsAndAriaAttributes();
testEveryInteractiveElementIsARealButton();
testIconsAreAccompaniedByTextOrAriaHidden();
testHeadingHierarchy();
testResponsiveStructuralRules();
testComponentsOnlyConsumeViewModelTypes();
testQaFixturesHaveNoRealQueriesOrPii();
testQaRouteReusesExistingAccessPolicy();
testQaClientCleansUpTimersOnUnmount();
testTimerCallbacksStillReceiveOriginalCycleId();

console.log("cycle-history-components-contract tests passed");
