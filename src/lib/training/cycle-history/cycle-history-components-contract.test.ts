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
const selectedSource = readFileSync("src/components/training/cycle-history/CycleHistorySelectedCycle.tsx", "utf8");
const compactSource = readFileSync("src/components/training/cycle-history/CycleHistoryCompactCycle.tsx", "utf8");
const statesSource = readFileSync("src/components/training/cycle-history/CycleHistoryStates.tsx", "utf8");
const summarySource = readFileSync("src/components/training/cycle-history/CycleHistorySummary.tsx", "utf8");
const cssSource = readFileSync("src/components/training/cycle-history/cycle-history.module.css", "utf8");
const viewModelSource = readFileSync("src/lib/training/cycle-history/cycle-history-view-model.ts", "utf8");
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
  assert.match(
    screenSource,
    /case "error":\s*\n\s*return <CycleHistoryErrorState message={listState\.error\.message} onRetry={onRetryList} \/>;/,
  );
  assert.match(statesSource, /<div className={styles\.stateError} role="alert">/);
  assert.doesNotMatch(statesSource, /stack|Supabase|postgres|PGRST|23505/i);
}

// 9. Estado ready.
function testScreenHandlesReadyState() {
  assert.match(screenSource, /case "ready": {/);
  assert.match(screenSource, /buildCycleHistoryListViewModels\(listState\.cycles\)/);
  assert.match(screenSource, /<CycleHistoryList/);
}

// 1 y 2. Título y descripción exactos aprobados por Producto (H1-C.2).
function testExactApprovedTitleAndDescription() {
  assert.match(
    screenSource,
    /<h1 className={styles\.title}>Revisa tu historial de ciclo de entrenamiento<\/h1>/,
  );
  assert.match(
    screenSource,
    /Podrás visualizar y descargar en PDF toda la información de tu ciclo de entrenamiento\./,
  );
  assert.doesNotMatch(screenSource, /Historial de ciclos<\/p>|Selecciona un ciclo para ver su resumen/);
}

// Separador visual bajo el encabezado.
function testHeaderHasVisualDivider() {
  assert.match(screenSource, /<hr className={styles\.headerDivider} \/>/);
  assert.match(cssSource, /\.headerDivider {[^}]*border-top: 1px solid var\(--line\);[^}]*}/);
}

// 3. El ciclo seleccionado usa una clase visual propia (barra azul), no la tarjeta anterior.
function testSelectedCycleHasDedicatedVisualClass() {
  assert.match(selectedSource, /className={styles\.selectedBar}/);
  assert.match(cssSource, /\.selectedBar {/);
  assert.match(cssSource, /\.selectedBar {[^}]*background: var\(--primary\);[^}]*}/);
}

// 4. Los ciclos no seleccionados usan una clase visual "contraída" (barra transparente).
function testCompactCyclesHaveDedicatedVisualClass() {
  assert.match(compactSource, /className={styles\.compactBar}/);
  assert.match(cssSource, /\.compactBar {[^}]*background: transparent;[^}]*}/);
}

// 5. Ausencia de chips de estado (Activo/Completado/Cancelado) en la pantalla principal.
function testNoStatusChipsRendered() {
  for (const source of [selectedSource, compactSource, listSource, summarySource]) {
    assert.doesNotMatch(source, /statusLabel|cardChip|cardStatus/);
  }
  assert.doesNotMatch(cssSource, /\.cardChip|\.cardStatus/);
}

// 6. Ausencia de chevrons visibles.
function testNoVisibleChevronIcon() {
  for (const source of [selectedSource, compactSource, listSource, summarySource]) {
    assert.doesNotMatch(source, /ChevronDown/);
  }
  assert.doesNotMatch(cssSource, /cardChevron/);
}

// 7. Ausencia de tablas/rutinas/ejercicios en la pantalla principal (removidos del diseño aprobado).
function testNoRoutineBreakdownOrTablesOnMainScreen() {
  for (const source of [screenSource, listSource, selectedSource, compactSource, summarySource, statesSource]) {
    assert.doesNotMatch(source, /<table|CycleHistoryRoutineBreakdown|weekTable/);
  }
  assert.doesNotMatch(viewModelSource, /CycleHistoryRoutineViewModel|CycleHistoryExerciseViewModel|CycleHistoryWeekRowViewModel/);
}

// 8. Fecha y botón de descarga de PDF conviven en la misma fila/sección.
function testDateAndPdfButtonShareSameRow() {
  assert.match(selectedSource, /<div className={styles\.dateAndPdfRow}>/);
  assert.match(selectedSource, /Fecha: {cycle\.dateRowLabel}/);
  assert.match(selectedSource, /Descargar PDF/);
}

// 9. Las tres métricas principales del diseño aprobado, en el orden correcto.
function testThreeMainMetricsInOrder() {
  assert.match(viewModelSource, /label: "Volumen registrado"/);
  assert.match(viewModelSource, /label: "Total volumen progreso"/);
  assert.match(viewModelSource, /label: "Ejercicios registrados"/);
  assert.match(summarySource, /detail\.metricCards\.map/);
  assert.match(cssSource, /\.metricsRow {[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*}/);
}

// El componente de resumen solo consume el view model de presentación, no datos crudos de H1-B.
function testSummaryOnlyConsumesViewModelType() {
  assert.match(summarySource, /detail: CycleHistoryDetailViewModel/);
  assert.doesNotMatch(summarySource, /CycleHistoryBreakdown|CycleHistoryMetricsSummary/);
}

// 10, 11, 12. El mensaje de progreso destaca el valor real por tono (verde/rojo/neutro), sin ser
// una alerta de ancho completo.
function testProgressMessageUsesToneHighlightMapping() {
  assert.match(summarySource, /TONE_CLASS_NAME: Record<CycleHistoryToneKind, string>/);
  assert.match(summarySource, /positive: styles\.tonePositive/);
  assert.match(summarySource, /negative: styles\.toneNegative/);
  assert.match(summarySource, /neutral: styles\.toneNeutral/);
  assert.match(summarySource, /detail\.volumeProgress\.highlight \?/);
  assert.doesNotMatch(
    cssSource,
    /\.progressMessage {[^}]*border[^}]*}/,
    "el mensaje de progreso ya no debe ser una alerta con borde de ancho completo",
  );
}

// El texto descriptivo del mensaje de progreso es blanco (var(--text)) y centrado; solo el valor
// numérico destacado usa el color de tono (verde/rojo) via .progressHighlight.
function testProgressMessageTextIsWhiteAndCentered() {
  assert.match(cssSource, /\.progressMessage {[^}]*color: var\(--text\);[^}]*}/);
  assert.match(cssSource, /\.progressMessage {[^}]*text-align: center;[^}]*}/);
}

// 13, 14, 15, 16, 17, 18. trainingDayCount se consume tal cual desde CycleHistoryCycleMetadata
// (nunca desde plan/routines/sessions/breakdown/fechas/snapshot/ejercicios), respeta singular/plural,
// omite el segmento limpiamente cuando es null y no deja separadores finales sobrantes.
function testBarLabelUsesRealTrainingDayCountWithSingularPluralAndCleanOmission() {
  assert.match(
    viewModelSource,
    /function buildCycleHistoryBarLabel\(cycle: CycleHistoryCycleMetadata\): string \{/,
    "el helper de la barra debe recibir CycleHistoryCycleMetadata directamente, no plan/breakdown/sessions",
  );
  assert.match(viewModelSource, /cycle\.trainingDayCount/);

  const barLabelSourceBlock = /function buildCycleHistoryBarLabel[\s\S]*?\n}\n\nfunction formatWeeksSegment[\s\S]*?\n}\n\n[\s\S]*?function formatTrainingDaysSegment[\s\S]*?\n}/.exec(
    viewModelSource,
  )?.[0] ?? "";
  assert.ok(barLabelSourceBlock.length > 0, "no se pudo aislar el bloque de la barra para verificar que no lee plan/breakdown/sessions");
  assert.doesNotMatch(
    barLabelSourceBlock,
    /\.plan\b|\.routines\b|\.sessions\b|\.breakdown\b/,
    "no debe recalcularse trainingDayCount desde plan/routines/sessions/breakdown en la capa de presentación",
  );
  assert.match(
    viewModelSource,
    /trainingDayCount === 1 \? "día" : "días"/,
    "debe respetar singular (1 día) y plural (N días)",
  );
  assert.match(
    viewModelSource,
    /if \(trainingDayCount === null \|\| !Number\.isFinite\(trainingDayCount\) \|\| trainingDayCount <= 0\) return null;/,
    "trainingDayCount ausente/no positivo debe omitir el segmento (nunca '0 días' ni 'null días' ni un valor inventado)",
  );
  assert.match(
    viewModelSource,
    /segments\.length > 0 \? `\$\{namePart\} \| \$\{segments\.join\(" \| "\)\}` : namePart/,
    "sin separadores finales sobrantes cuando faltan segmentos",
  );
}

// 27. Fixtures QA muestran los tres casos reales exigidos: 3, 4 y null.
function testQaFixturesCoverTrainingDayCountThreeFourAndNull() {
  assert.match(qaFixturesSource, /trainingDayCount: 3,/);
  assert.match(qaFixturesSource, /trainingDayCount: 4,/);
  assert.match(qaFixturesSource, /trainingDayCount: null,/);
}

// 19. Los callbacks siguen recibiendo el cycleId real (no normalizado) del ciclo correspondiente.
function testCallbacksReceiveOriginalCycleId() {
  assert.match(listSource, /onToggle={\(\) => onToggleCycle\(cycle\.cycleId\)}/);
  assert.match(listSource, /onRetry={\(\) => onRetry\(cycle\.cycleId\)}/);
  assert.match(listSource, /onDownloadPdf={\(\) => onDownloadPdf\(cycle\.cycleId\)}/);
}

// 20. IDs DOM saneados via los helpers de H1-C.1, para el ciclo seleccionado y los compactos.
function testDomIdsUseSanitizedHelpers() {
  for (const source of [selectedSource, compactSource]) {
    assert.match(source, /buildCycleHistoryDetailDomId\(cycle\.cycleId\)/);
    assert.match(source, /buildCycleHistoryHeadingDomId\(cycle\.cycleId\)/);
  }
}

// 21. Expansión única: `CycleHistoryList` deriva el seleccionado y excluye ese mismo id de los compactos.
// 21. Expansión única SIN reordenar: cada ciclo se renderiza en su posición original de la lista
// (cycles.map en orden recibido); expandir un ciclo no lo separa a una sección "arriba" ni lo mueve
// de lugar — solo cambia su presentación (barra compacta -> seleccionada) en el mismo puesto.
function testExpansionDoesNotReorderCycles() {
  assert.match(listSource, /cycles\.map\(\(cycle\) => \{/);
  assert.match(listSource, /const isSelected = cycle\.cycleId === expandedCycleId;/);
  assert.doesNotMatch(
    listSource,
    /cycles\.find\(|cycles\.filter\(/,
    "el ciclo seleccionado no debe extraerse/filtrarse a una sección aparte: debe conservar su posición original en la lista",
  );
  assert.match(viewModelSource, /export function resolveNextExpandedCycleId/);
}

// Solo el ciclo seleccionado recibe el detailState real; los compactos ni siquiera lo referencian.
function testOnlySelectedCycleReceivesRealDetailState() {
  assert.match(listSource, /detailState={detailState}/);
  assert.doesNotMatch(compactSource, /detailState/);
}

// El vaciamiento de un detalle vacio se distingue de un error (estados separados), en el ciclo seleccionado.
function testEmptyDetailIsDistinctFromError() {
  assert.match(
    selectedSource,
    /case "empty":\s*\n\s*return <CycleHistoryEmptyState message="Este ciclo todavía no tiene semanas registradas\." \/>;/,
  );
  assert.match(selectedSource, /case "error":\s*\n\s*return \(/);
}

// El boton PDF usa la funcion pura de deshabilitado, nunca un booleano manual.
function testPdfButtonUsesPureDisabledLogic() {
  assert.match(selectedSource, /disabled={isCycleHistoryPdfActionDisabled\(detailState\.status, isPdfActionBusy\)}/);
}

// IDs estables y aria-expanded/aria-controls correctos.
function testStableIdsAndAriaAttributes() {
  assert.match(selectedSource, /const detailId = buildCycleHistoryDetailDomId\(cycle\.cycleId\);/);
  assert.match(selectedSource, /const headingId = buildCycleHistoryHeadingDomId\(cycle\.cycleId\);/);
  assert.match(selectedSource, /aria-expanded={true}/);
  assert.match(selectedSource, /aria-controls={detailId}/);
  assert.match(selectedSource, /id={headingId}/);
  assert.match(selectedSource, /<div id={detailId} role="region" aria-labelledby={headingId}/);

  assert.match(compactSource, /aria-expanded={false}/);
  assert.match(compactSource, /aria-controls={detailId}/);
  assert.match(compactSource, /id={headingId}/);
}

// Botones reales, no divs clickeables: cada onClick debe estar en un <button type="button">.
function testEveryInteractiveElementIsARealButton() {
  for (const source of [selectedSource, compactSource, statesSource]) {
    const onClickCount = countMatches(source, /onClick={/);
    const typeButtonCount = countMatches(source, /type="button"/);
    assert.ok(
      typeButtonCount >= onClickCount,
      "cada onClick debe corresponder a un <button type=\"button\">, nunca a un div clickeable",
    );
  }
  assert.doesNotMatch(selectedSource, /<div[^>]*onClick=/);
  assert.doesNotMatch(compactSource, /<div[^>]*onClick=/);
  assert.doesNotMatch(statesSource, /<div[^>]*onClick=/);
}

// Iconos acompañados de texto o aria-hidden (Download/AlertTriangle/RefreshCw nunca solos sin texto).
function testIconsAreAccompaniedByTextOrAriaHidden() {
  assert.match(selectedSource, /<Download[\s\S]*?aria-hidden="true"/);
  assert.match(statesSource, /<AlertTriangle[\s\S]*?aria-hidden="true"/);
  assert.match(statesSource, /<RefreshCw[\s\S]*?aria-hidden="true"/);
}

// Encabezado jerarquico: h1 en la pantalla (ya no hay h2/h3 de rutinas/ejercicios, removidos del diseño aprobado).
function testHeadingHierarchy() {
  assert.match(screenSource, /<h1 className={styles\.title}>/);
}

// 22, 23. Render responsive: breakpoint mobile explícito, sin ancho fijo (px) que rompa pantallas
// pequeñas, sin degradados en las barras de ciclos.
function testResponsiveStructuralRules() {
  assert.match(cssSource, /@media \(max-width: 520px\) {/);
  assert.doesNotMatch(
    cssSource,
    /(?<!min-|max-)\bwidth:\s*\d+px;/,
    "no debe usarse un ancho fijo (width, sin min-/max-) en px que rompa pantallas pequeñas",
  );
}

function testNoGradientsOnCycleBars() {
  const selectedBarBlock = /\.selectedBar\s*{[^}]*}/.exec(cssSource)?.[0] ?? "";
  const compactBarBlock = /\.compactBar\s*{[^}]*}/.exec(cssSource)?.[0] ?? "";
  assert.ok(selectedBarBlock.length > 0);
  assert.ok(compactBarBlock.length > 0);
  assert.doesNotMatch(selectedBarBlock, /gradient/i);
  assert.doesNotMatch(compactBarBlock, /gradient/i);
}

// 25. Fixtures QA: sin PII real, sin Supabase, sin repositorios, sin data source.
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

// 24. Cleanup de timers en el cliente QA (H1-C.1): ids guardados en useRef, cancelados en el
// cleanup de useEffect al desmontar, reemplazados antes de programar uno nuevo (evita residuales
// al cambiar rápidamente de ciclo), y sin setState tras el unmount. Debe permanecer intacto.
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

// Los callbacks del cliente QA siguen recibiendo el cycleId original real, no una version normalizada.
function testTimerCallbacksStillReceiveOriginalCycleId() {
  assert.match(qaClientSource, /function loadDetail\(cycleId: string\) \{/);
  assert.match(qaClientSource, /setDetailState\(\{ status: "loading", cycleId \}\);/);
  assert.match(qaClientSource, /setDetailState\(\{ status: "error", cycleId, error: QA_SIMULATED_ERROR \}\);/);
  assert.match(qaClientSource, /function handleDownloadPdf\(cycleId: string\) \{/);
  assert.match(qaClientSource, /setLastPdfCallback\(cycleId\);/);
}

function testQaClientKeepsListRetryCallbackConnected() {
  assert.match(qaClientSource, /onRetryList={\(\) => setListScenario\("ready"\)}/);
}

// 25. La ruta QA reutiliza la politica QA existente, igual que las demas herramientas QA.
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
testExactApprovedTitleAndDescription();
testHeaderHasVisualDivider();
testSelectedCycleHasDedicatedVisualClass();
testCompactCyclesHaveDedicatedVisualClass();
testNoStatusChipsRendered();
testNoVisibleChevronIcon();
testNoRoutineBreakdownOrTablesOnMainScreen();
testDateAndPdfButtonShareSameRow();
testThreeMainMetricsInOrder();
testSummaryOnlyConsumesViewModelType();
testProgressMessageUsesToneHighlightMapping();
testProgressMessageTextIsWhiteAndCentered();
testBarLabelUsesRealTrainingDayCountWithSingularPluralAndCleanOmission();
testQaFixturesCoverTrainingDayCountThreeFourAndNull();
testCallbacksReceiveOriginalCycleId();
testDomIdsUseSanitizedHelpers();
testExpansionDoesNotReorderCycles();
testOnlySelectedCycleReceivesRealDetailState();
testEmptyDetailIsDistinctFromError();
testPdfButtonUsesPureDisabledLogic();
testStableIdsAndAriaAttributes();
testEveryInteractiveElementIsARealButton();
testIconsAreAccompaniedByTextOrAriaHidden();
testHeadingHierarchy();
testResponsiveStructuralRules();
testNoGradientsOnCycleBars();
testQaFixturesHaveNoRealQueriesOrPii();
testQaClientCleansUpTimersOnUnmount();
testTimerCallbacksStillReceiveOriginalCycleId();
testQaClientKeepsListRetryCallbackConnected();
testQaRouteReusesExistingAccessPolicy();

console.log("cycle-history-components-contract tests passed");
