import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  renderCycleHistoryPdfWithDependencies,
  type CycleHistoryAutoTableOptions,
  type CycleHistoryPdfCellHookCell,
  type CycleHistoryPdfCellHookData,
  type CycleHistoryPdfDocumentLike,
  type CycleHistoryPdfDocumentOptions,
} from "@/lib/training/cycle-history/cycle-history-pdf-renderer";
import type {
  CycleHistoryPdfWeekCellRow,
  CycleHistoryPdfWeekRegistrationCell,
} from "@/lib/training/cycle-history/cycle-history-pdf-presentation";
import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type { CycleHistoryWeekRegistration } from "@/lib/training/cycle-history/cycle-history-types";
import { buildCycleHistoryPdfTestModel } from "@/lib/training/cycle-history/cycle-history-pdf-test-fixtures";

interface TextOperation {
  page: number;
  text: string;
  x?: number;
  y?: number;
  align?: "left" | "center" | "right";
}

/**
 * Ancho fijo por carácter (mm) usado por el `FakePdfDocument` de este archivo para simular medición
 * de texto de forma determinista. Se usa consistentemente en `getTextWidth` y `splitTextToSize` para
 * que ambas midan "lo mismo", igual que exige el renderer real de jsPDF.
 */
const FAKE_CHAR_WIDTH_MM = 1.6;

class FakePdfDocument implements CycleHistoryPdfDocumentLike {
  currentPage = 1;
  pageCount = 1;
  textOperations: TextOperation[] = [];
  tablePages = new Set<number>();
  properties: { title: string; subject: string; creator: string } | null = null;
  lastAutoTable?: { finalY?: number };
  internal = {
    pageSize: {
      getWidth: () => 297,
      getHeight: () => 210,
    },
  };

  addPage() {
    this.pageCount += 1;
    this.currentPage = this.pageCount;
  }

  getCurrentPageInfo() {
    return { pageNumber: this.currentPage };
  }

  getNumberOfPages() {
    return this.pageCount;
  }

  line() {}
  setDrawColor() {}
  setFont() {}
  setFontSize() {}
  setLineWidth() {}
  setTextColor() {}

  output(type: "blob") {
    assert.equal(type, "blob");
    return new Blob(["%PDF-fixture"], { type: "application/pdf" });
  }

  setPage(pageNumber: number) {
    this.currentPage = pageNumber;
  }

  setProperties(properties: { title: string; subject: string; creator: string }) {
    this.properties = properties;
  }

  splitTextToSize(text: string, maxWidth: number) {
    // Simula el fallback de partición por caracteres de jsPDF real (confirmado empíricamente: sin
    // espacios, jsPDF corta en cualquier carácter). Determinista vía FAKE_CHAR_WIDTH_MM.
    if (text.includes("\n")) return text.split("\n");
    const maxChars = Math.max(1, Math.floor(maxWidth / FAKE_CHAR_WIDTH_MM));
    if (text.length <= maxChars) return [text];
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > maxChars) {
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    if (remaining.length > 0) lines.push(remaining);
    return lines;
  }

  getTextWidth(text: string) {
    return text.length * FAKE_CHAR_WIDTH_MM;
  }

  text(value: string | string[], x?: number, y?: number, options?: { align?: "left" | "center" | "right" }) {
    this.textOperations.push({
      page: this.currentPage,
      text: Array.isArray(value) ? value.join("\n") : value,
      x,
      y,
      align: options?.align,
    });
  }
}

function testRenderUsesLandscapeA4TablesAndEveryPageFooters() {
  let documentOptions: CycleHistoryPdfDocumentOptions | null = null;
  const document = new FakePdfDocument();
  const tableOptions: CycleHistoryAutoTableOptions[] = [];

  const blob = renderCycleHistoryPdfWithDependencies(buildCycleHistoryPdfTestModel(), {
    createDocument(options) {
      documentOptions = options;
      return document;
    },
    autoTable(fakeDocument, options) {
      tableOptions.push(options);
      document.tablePages.add(document.currentPage);
      options.willDrawPage();
      document.addPage();
      document.tablePages.add(document.currentPage);
      options.willDrawPage();
      fakeDocument.lastAutoTable = { finalY: 55 };
    },
  });

  assert.deepEqual(documentOptions, {
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    putOnlyUsedFonts: true,
    compress: true,
  });
  assert.equal(blob.type, "application/pdf");
  assert.ok(blob.size > 0);
  assert.equal(tableOptions.length, 3);
  for (const options of tableOptions) {
    assert.equal(options.showHead, "everyPage");
    assert.equal(options.rowPageBreak, "avoid");
    assert.equal(options.pageBreak, "auto");
    assert.deepEqual(options.margin, { top: 25, right: 14, bottom: 18, left: 14 });
    assert.equal(options.theme, "grid");
  }
  assert.deepEqual(document.properties, {
    title: "Historial de ciclo de entrenamiento",
    subject: "Resumen de ciclo de entrenamiento",
    creator: "Organizatech",
  });

  assert.ok(document.pageCount > 1, "el fixture debe cubrir varias páginas");
  for (let page = 1; page <= document.pageCount; page += 1) {
    const pageText = document.textOperations
      .filter((operation) => operation.page === page)
      .map((operation) => operation.text);
    assert.ok(pageText.includes("Organizatech"), `falta header en página ${page}`);
    assert.ok(pageText.includes(`Página ${page} de ${document.pageCount}`), `falta footer en página ${page}`);
    const hasBodyText = pageText.some(
      (text) =>
        text !== "Organizatech" &&
        text !== "Historial de ciclo de entrenamiento" &&
        !text.startsWith("Generado:") &&
        !text.startsWith("Página "),
    );
    assert.ok(document.tablePages.has(page) || hasBodyText, `la página ${page} no debe quedar vacía`);
  }
}

function testEmptyModelDoesNotRenderTablesOrExtraPages() {
  const model = buildCycleHistoryPdfTestModel();
  model.routines = [];
  const document = new FakePdfDocument();
  let tableCalls = 0;

  renderCycleHistoryPdfWithDependencies(model, {
    createDocument: () => document,
    autoTable() {
      tableCalls += 1;
    },
  });

  assert.equal(tableCalls, 0);
  assert.equal(document.pageCount, 1);
  assert.ok(document.textOperations.some((operation) => operation.text === "Este ciclo no tiene semanas registradas."));
}

function buildWeekRegistrationCellFixture(): CycleHistoryPdfWeekRegistrationCell {
  return buildWeekRegistrationCellFixtureWithEntries(1);
}

/** Fixture con `entryCount` registros (series), reproduciendo el shape real que produce `formatWeekRegistration`. */
function buildWeekRegistrationCellFixtureWithEntries(entryCount: number): CycleHistoryPdfWeekRegistrationCell {
  const rows: CycleHistoryPdfWeekCellRow[] = [];
  let totalReps = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const isLast = index === entryCount - 1;
    totalReps += 40;
    rows.push({ left: `Series registradas: 4`, right: `Peso: ${100 + index * 5} kg` });
    rows.push({ left: "Repeticiones: 10/10/10/10", right: isLast ? `Total reps: ${totalReps}` : null });
  }
  return {
    kind: "registration",
    rows,
    totalLine: `Volumen total: ${(entryCount * 4000).toLocaleString("es-CL")} kg`,
  };
}

function captureAutoTableOptions(): { document: FakePdfDocument; options: CycleHistoryAutoTableOptions } {
  const document = new FakePdfDocument();
  let capturedOptions: CycleHistoryAutoTableOptions | null = null;

  renderCycleHistoryPdfWithDependencies(buildCycleHistoryPdfTestModel(), {
    createDocument: () => document,
    autoTable(_fakeDocument, options) {
      capturedOptions ??= options;
      document.lastAutoTable = { finalY: 55 };
    },
  });

  assert.ok(capturedOptions, "el renderer debe invocar autoTable al menos una vez para un modelo con rutinas");
  return { document, options: capturedOptions };
}

/**
 * Ejecuta el ciclo real didParseCell + didDrawCell para una celda de semana con `entryCount`
 * registros, y valida el invariante central de H1-E.2.1: TODA línea dibujada (izquierda, derecha o el
 * total centrado) debe quedar dentro de `[cell.y, cell.y + minCellHeight]` — el mismo alto que se
 * reservó. Como ambos valores provienen de `computeWeekRegistrationCellLayout` (fuente única), nunca
 * pueden divergir, sin importar cuántos registros tenga la semana.
 */
function verifyWeekCellLayoutInvariants(
  entryCount: number,
  cellWidth = 80,
): { cell: ReturnType<typeof buildTestCell>; textOperations: TextOperation[] } {
  const raw = buildWeekRegistrationCellFixtureWithEntries(entryCount);
  const cell = buildTestCell(raw, cellWidth);

  const parsePass = captureAutoTableOptions();
  parsePass.options.didParseCell({ cell, column: { index: 99 } });
  assert.deepEqual(cell.text, [], "el texto por defecto de la celda debe vaciarse: el contenido real se dibuja aparte");
  assert.ok(
    typeof cell.styles.minCellHeight === "number" && cell.styles.minCellHeight > 0,
    "didParseCell debe fijar minCellHeight con el alto real necesario",
  );

  const drawPass = captureAutoTableOptions();
  drawPass.document.textOperations = [];
  drawPass.options.didDrawCell({ cell, column: { index: 99 } });

  const cellTop = cell.y;
  const cellBottom = cell.y + (cell.styles.minCellHeight ?? 0);
  for (const operation of drawPass.document.textOperations) {
    assert.ok(
      operation.y! >= cellTop && operation.y! <= cellBottom,
      `la línea "${operation.text}" en y=${operation.y} debe quedar dentro del alto reservado [${cellTop}, ${cellBottom}] (${entryCount} registros)`,
    );
  }

  return { cell, textOperations: drawPass.document.textOperations };
}

function buildTestCell(raw: CycleHistoryPdfWeekRegistrationCell | string, width: number): CycleHistoryPdfCellHookCell {
  return { raw, text: ["placeholder"], x: 20, y: 30, width, height: 20, styles: { cellPadding: 2 } };
}

// 1. Un registro: formato compacto sin regresiones (par izquierda/derecha por fila + total centrado).
function testSingleEntryWeekKeepsCompactFormatWithoutRegressions() {
  const { cell, textOperations } = verifyWeekCellLayoutInvariants(1);

  const leftTexts = textOperations.filter((operation) => operation.align === undefined).map((operation) => operation.text);
  const rightTexts = textOperations.filter((operation) => operation.align === "right").map((operation) => operation.text);
  const centerTexts = textOperations.filter((operation) => operation.align === "center").map((operation) => operation.text);

  assert.deepEqual(leftTexts, ["Series registradas: 4", "Repeticiones: 10/10/10/10"]);
  assert.deepEqual(rightTexts, ["Peso: 100 kg", "Total reps: 40"]);
  assert.deepEqual(centerTexts, ["Volumen total: 4.000 kg"]);

  const rightOperation = textOperations.find((operation) => operation.align === "right");
  assert.equal(
    rightOperation?.x,
    cell.x + cell.width - cell.styles.cellPadding,
    "el valor derecho debe pegarse al borde derecho de la celda, no simplemente concatenarse a la izquierda",
  );
  const centerOperation = textOperations.find((operation) => operation.align === "center");
  assert.equal(centerOperation?.x, cell.x + cell.width / 2, "el volumen total debe quedar centrado en el ancho de la celda");
}

// 2. Dos registros: el alto reservado debe ser suficiente (invariante ya verificado por el helper).
function testTwoEntryWeekReservesSufficientHeight() {
  const { textOperations } = verifyWeekCellLayoutInvariants(2);
  assert.equal(textOperations.filter((operation) => operation.align === undefined).length, 4, "2 registros = 4 líneas izquierdas");
}

// 3. Tres registros: la última línea debe quedar dentro del borde inferior (invariante del helper).
function testThreeEntryWeekKeepsLastLineWithinBottomBorder() {
  const { textOperations } = verifyWeekCellLayoutInvariants(3);
  assert.equal(textOperations.filter((operation) => operation.align === undefined).length, 6, "3 registros = 6 líneas izquierdas");
}

// 4. Cuatro registros: "Volumen total" queda dentro de la celda, y la fila siguiente (posicionada
// justo después del alto reservado) no queda invadida por ninguna línea de esta celda.
function testFourEntryWeekKeepsTotalWithinCellAndAvoidsRowInvasion() {
  const { cell, textOperations } = verifyWeekCellLayoutInvariants(4);

  const centerOperation = textOperations.find((operation) => operation.align === "center");
  assert.ok(centerOperation, "debe dibujarse el volumen total");
  const cellBottom = cell.y + (cell.styles.minCellHeight ?? 0);
  assert.ok(centerOperation!.y! <= cellBottom, "Volumen total debe quedar dentro del borde inferior de la celda");

  // La fila siguiente empezaría exactamente en cellBottom: ninguna línea de esta celda puede llegar
  // a esa altura o más allá (evita invadir la fila siguiente).
  for (const operation of textOperations) {
    assert.ok(operation.y! < cellBottom + 0.01, `la línea "${operation.text}" no debe invadir la fila siguiente (y=${operation.y}, límite=${cellBottom})`);
  }
}

// 5. Muchas series: el texto largo se envuelve (nunca se pierde una repetición), left/right no se
// cruzan, y el alto reservado incorpora las líneas adicionales generadas por el envolvido.
function testManySeriesEntryWrapsWithoutLosingRepsAndKeepsAlignment() {
  const reps = Array.from({ length: 12 }, () => 12);
  const raw: CycleHistoryPdfWeekRegistrationCell = {
    kind: "registration",
    rows: [
      { left: "Series registradas: 12", right: "Peso: 60 kg" },
      { left: `Repeticiones: ${reps.join("/")}`, right: "Total reps: 144" },
    ],
    totalLine: "Volumen total: 8.640 kg",
  };
  // Celda angosta a propósito para forzar el envolvido del texto de repeticiones.
  const cell = buildTestCell(raw, 40);

  const parsePass = captureAutoTableOptions();
  parsePass.options.didParseCell({ cell, column: { index: 99 } });
  assert.ok((cell.styles.minCellHeight ?? 0) > 0);

  const drawPass = captureAutoTableOptions();
  drawPass.document.textOperations = [];
  drawPass.options.didDrawCell({ cell, column: { index: 99 } });

  const leftTexts = drawPass.document.textOperations.filter((operation) => operation.align === undefined).map((operation) => operation.text);
  const rightTexts = drawPass.document.textOperations.filter((operation) => operation.align === "right").map((operation) => operation.text);

  const repsStartIndex = leftTexts.findIndex((text) => text.startsWith("Repeticiones"));
  assert.ok(repsStartIndex >= 0, "debe existir una línea que comience con 'Repeticiones:'");
  const repsLines = leftTexts.slice(repsStartIndex);
  assert.ok(repsLines.length > 1, "el texto de repeticiones largo debe envolverse en más de una línea cuando no cabe en el ancho disponible");

  // No se pierde ninguna repetición: reconstruyendo las líneas envueltas se recupera el texto exacto.
  assert.equal(repsLines.join(""), `Repeticiones: ${reps.join("/")}`);
  // Ninguna repetición quedó partida a mitad de número: cada línea envuelta, salvo la última, termina
  // justo después de un "/" completo (nunca en medio de un "12").
  for (const line of repsLines.slice(0, -1)) {
    assert.match(line, /\/$/, `la línea envuelta "${line}" no debe cortar un número a la mitad`);
  }

  // El total de repeticiones sigue apareciendo una sola vez, en su propia línea (a la derecha),
  // nunca en la misma línea que una línea de "Repeticiones" envuelta (left/right no se cruzan).
  assert.deepEqual(rightTexts, ["Peso: 60 kg", "Total reps: 144"]);
  assert.equal(drawPass.document.textOperations.filter((operation) => operation.text === "Total reps: 144").length, 1);

  // Ninguna línea izquierda desborda el ancho disponible de la celda.
  const availableWidth = cell.width - cell.styles.cellPadding * 2;
  for (const text of leftTexts) {
    assert.ok(text.length * FAKE_CHAR_WIDTH_MM <= availableWidth + 0.001, `la línea "${text}" no debe desbordar el ancho disponible de la celda`);
  }

  // El alto reservado incorpora las líneas adicionales del envolvido (más líneas que en el caso de
  // una celda ancha sin envolvido).
  const wideCellFixture = buildWeekRegistrationCellFixtureWithEntries(1);
  const wideCell = buildTestCell(wideCellFixture, 80);
  const widePass = captureAutoTableOptions();
  widePass.options.didParseCell({ cell: wideCell, column: { index: 99 } });
  assert.ok(
    (cell.styles.minCellHeight ?? 0) > (wideCell.styles.minCellHeight ?? 0),
    "una celda con texto envuelto en más líneas debe reservar más alto que una celda sin envolvido",
  );
}

// Las celdas "Sin registro" (texto plano) y las columnas Ejercicio/Objetivo (índice < 2) no deben
// verse afectadas por el dibujo custom de semanas.
function testPlainCellsAreUntouchedByCustomWeekDrawing() {
  const parsePass = captureAutoTableOptions();
  const plainCell = { raw: "Sin registro", text: ["Sin registro"], x: 20, y: 30, width: 60, height: 20, styles: { cellPadding: 2 } };
  parsePass.options.didParseCell({ cell: plainCell, column: { index: 99 } });
  assert.deepEqual(plainCell.text, ["Sin registro"], "una celda de texto plano no debe reemplazarse por líneas en blanco");

  const drawPass = captureAutoTableOptions();
  drawPass.document.textOperations = [];
  drawPass.options.didDrawCell({ cell: plainCell, column: { index: 99 } });
  assert.equal(
    drawPass.document.textOperations.length,
    0,
    "una celda de texto plano la sigue dibujando autoTable por defecto, no nuestro dibujo custom",
  );

  const exerciseColumnCell = { raw: buildWeekRegistrationCellFixture(), text: ["algo"], x: 0, y: 0, width: 10, height: 10, styles: { cellPadding: 2 } };
  parsePass.options.didParseCell({ cell: exerciseColumnCell, column: { index: 0 } });
  assert.deepEqual(exerciseColumnCell.text, ["algo"], "las columnas Ejercicio/Objetivo (indice < 2) no deben verse afectadas");
}

function buildIntegrationWeekRegistration(
  weekNumber: number,
  entryCount: number,
  reps: number[],
  baseWeight: number,
): CycleHistoryWeekRegistration {
  const series = Array.from({ length: entryCount }, (_, index) => {
    const weight = baseWeight + index * 5;
    const volume = weight * reps.reduce((sum, rep) => sum + rep, 0);
    return { entryId: `entry-w${weekNumber}-${index}`, weight, reps, volume };
  });
  const totalReps = series.reduce((sum, entry) => sum + entry.reps.reduce((a, b) => a + b, 0), 0);
  const volume = series.reduce((sum, entry) => sum + entry.volume, 0);
  return { week: weekNumber, series, totalReps, volume };
}

interface RealTextOperation {
  text: string;
  x: number;
  y: number;
  page: number;
  align?: "left" | "center" | "right";
  width: number;
}

/**
 * Instrumenta `document.text` de un jsPDF real: registra texto/x/y/align/página y el ancho medido EN
 * VIVO (con el estado de fuente activo en ese instante — el único momento en que `getTextWidth` mide
 * correctamente esa línea concreta), y siempre delega a la implementación real. No reemplaza su
 * comportamiento, solo lo observa.
 */
function instrumentRealDocumentText(doc: {
  text: (text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }) => unknown;
  getCurrentPageInfo: () => { pageNumber: number };
  getTextWidth: (text: string) => number;
}): RealTextOperation[] {
  const textOps: RealTextOperation[] = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }) => {
    const page = doc.getCurrentPageInfo().pageNumber;
    for (const line of Array.isArray(text) ? text : [text]) {
      textOps.push({ text: line, x, y, page, align: options?.align, width: doc.getTextWidth(line) });
    }
    return originalText(text, x, y, options);
  };
  return textOps;
}

const GEOMETRY_TOLERANCE_MM = 0.05;

/**
 * Verifica, para las operaciones de texto dibujadas dentro de UNA celda de semana, que:
 * 1) ninguna se salga vertical u horizontalmente de los límites reales de la celda (`cell.x/y/width/
 *    height` ya calculados por autoTable, no `weekWidth` propio); 2) el texto derecho no se extienda
 *    antes del borde izquierdo; 3) el texto centrado quede dentro del ancho; 4) izquierda y derecha que
 *    comparten una misma línea (mismo y) nunca se crucen. Cualquier violación se agrega a `violations`.
 */
function checkWeekCellHorizontalGeometry(
  cellOps: RealTextOperation[],
  cell: { x: number; y: number; width: number; height: number; padding: number },
  violations: string[],
) {
  const left = cell.x + cell.padding;
  const right = cell.x + cell.width - cell.padding;
  const top = cell.y;
  const bottom = cell.y + cell.height;

  for (const operation of cellOps) {
    if (operation.y < top - GEOMETRY_TOLERANCE_MM || operation.y > bottom + GEOMETRY_TOLERANCE_MM) {
      violations.push(`vertical: "${operation.text}" y=${operation.y} fuera de [${top}, ${bottom}]`);
    }
    if (operation.align === "right") {
      if (operation.x > right + GEOMETRY_TOLERANCE_MM) {
        violations.push(`right: "${operation.text}" x=${operation.x} supera el borde derecho real ${right}`);
      }
      if (operation.x - operation.width < left - GEOMETRY_TOLERANCE_MM) {
        violations.push(`right: "${operation.text}" se extiende antes del borde izquierdo (inicio=${operation.x - operation.width})`);
      }
    } else if (operation.align === "center") {
      const halfWidth = operation.width / 2;
      if (operation.x - halfWidth < left - GEOMETRY_TOLERANCE_MM || operation.x + halfWidth > right + GEOMETRY_TOLERANCE_MM) {
        violations.push(`center: "${operation.text}" fuera de [${left}, ${right}] (x=${operation.x}, mitad=${halfWidth})`);
      }
    } else {
      if (operation.x < left - GEOMETRY_TOLERANCE_MM) {
        violations.push(`left: "${operation.text}" x=${operation.x} antes del borde izquierdo real ${left}`);
      }
      if (operation.x + operation.width > right + GEOMETRY_TOLERANCE_MM) {
        violations.push(`left: "${operation.text}" se extiende más allá del borde derecho real (fin=${operation.x + operation.width})`);
      }
    }
  }

  const opsByLine = new Map<number, RealTextOperation[]>();
  for (const operation of cellOps) {
    const key = Math.round(operation.y * 1000);
    const existing = opsByLine.get(key);
    if (existing) existing.push(operation);
    else opsByLine.set(key, [operation]);
  }
  for (const opsAtY of opsByLine.values()) {
    const leftOp = opsAtY.find((operation) => operation.align === undefined);
    const rightOp = opsAtY.find((operation) => operation.align === "right");
    if (leftOp && rightOp) {
      const leftEnd = leftOp.x + leftOp.width;
      const rightStart = rightOp.x - rightOp.width;
      if (leftEnd > rightStart + GEOMETRY_TOLERANCE_MM) {
        violations.push(
          `cruce: "${leftOp.text}" (termina en ${leftEnd}) se cruza con "${rightOp.text}" (empieza en ${rightStart}) en y=${leftOp.y}`,
        );
      }
    }
  }
}

/**
 * Renderiza `model` con jsPDF/jspdf-autotable REALES (nunca solo FakePdfDocument), instrumentando
 * `document.text` (delega siempre a la implementación real) y envolviendo `didDrawCell` para verificar
 * la geometría horizontal Y vertical real de cada celda de semana — usando `cell.x/y/width/height` ya
 * calculados por autoTable, no `weekWidth` del código productivo.
 */
async function renderModelWithGeometryInstrumentation(
  model: CycleHistoryPdfModel,
): Promise<{ blob: Blob; textOps: RealTextOperation[]; geometryViolations: string[] }> {
  const { jsPDF } = await import("jspdf");
  const { autoTable: realAutoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", putOnlyUsedFonts: true, compress: true });
  const textOps = instrumentRealDocumentText(doc);
  const geometryViolations: string[] = [];

  const blob = renderCycleHistoryPdfWithDependencies(model, {
    createDocument: () => doc as unknown as CycleHistoryPdfDocumentLike,
    autoTable: (_fakeDocument, options) => {
      const originalDidDrawCell = options.didDrawCell;
      const wrappedOptions = {
        ...options,
        didDrawCell: (data: CycleHistoryPdfCellHookData) => {
          const isWeekColumn = data.column.index >= 2 && typeof data.cell.raw === "object" && data.cell.raw !== null;
          if (!isWeekColumn) {
            originalDidDrawCell(data);
            return;
          }
          const startIndex = textOps.length;
          originalDidDrawCell(data);
          const cellOps = textOps.slice(startIndex);
          const padding = data.cell.styles.cellPadding ?? 2;
          checkWeekCellHorizontalGeometry(
            cellOps,
            { x: data.cell.x, y: data.cell.y, width: data.cell.width, height: data.cell.height, padding },
            geometryViolations,
          );
        },
      };
      (realAutoTable as unknown as (document: unknown, options: unknown) => void)(doc, wrappedOptions);
    },
  });

  return { blob, textOps, geometryViolations };
}

/** Verifica que ninguna operación previa en la misma página alcance/supere el inicio de `markerText`. */
function assertNoRowInvasion(textOps: RealTextOperation[], allTexts: string[], markerText: string) {
  const markerIndex = allTexts.indexOf(markerText);
  assert.ok(markerIndex >= 0, `debe existir la fila marcadora '${markerText}'`);
  const markerOp = textOps[markerIndex]!;
  const priorSamePage = textOps.slice(0, markerIndex).filter((operation) => operation.page === markerOp.page);
  const maxPriorY = Math.max(...priorSamePage.map((operation) => operation.y));
  assert.ok(
    maxPriorY <= markerOp.y + 0.01,
    `contenido previo (y=${maxPriorY}) no debe alcanzar/superar el inicio de '${markerText}' (y=${markerOp.y}) — indicaría invasión de fila`,
  );
}

/** Verifica que la secuencia completa de repeticiones entre `startMarker` y `endMarker` se conserve intacta y en orden. */
function assertRepsSequencePreserved(allTexts: string[], startMarker: string, endMarker: string, reps: number[]) {
  const startIndex = allTexts.indexOf(startMarker);
  const endIndex = allTexts.indexOf(endMarker);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `debe existir '${startMarker}' antes de '${endMarker}'`);
  const slice = allTexts.slice(startIndex, endIndex);
  const repsStart = slice.findIndex((text) => text.startsWith("Repeticiones"));
  assert.ok(repsStart >= 0, `debe existir la línea de repeticiones para ${startMarker}`);
  const repsLines: string[] = [];
  for (let index = repsStart; index < slice.length; index += 1) {
    const line = slice[index]!;
    if (index === repsStart || /^[\d/]+$/.test(line)) repsLines.push(line);
    else break;
  }
  assert.equal(
    repsLines.join(""),
    `Repeticiones: ${reps.join("/")}`,
    `no debe perderse ni reordenarse ninguna repetición de ${startMarker} (${reps.length} valores)`,
  );
  assert.equal(slice.filter((text) => text.startsWith("Total reps: ")).length, 1, `Total reps debe aparecer una sola vez para ${startMarker}`);
  assert.equal(slice.filter((text) => text.startsWith("Volumen total: ")).length, 1, `Volumen total debe aparecer una sola vez para ${startMarker}`);
}

function buildStressModelBoilerplate(cycleNumber: number, name: string): Pick<CycleHistoryPdfModel, "generatedAt" | "filename" | "personalData" | "cycle" | "metrics"> {
  return {
    generatedAt: "2026-07-22T12:00:00.000Z",
    filename: `organizatech-ciclo-${cycleNumber}-2026-07-22.pdf`,
    personalData: { fullName: null, email: null, birthDate: null, age: null, gender: "not_specified", phoneNumber: null },
    cycle: {
      cycleId: `cycle-stress-qa-${cycleNumber}`,
      name,
      cycleNumber,
      cycleType: "QA",
      status: "completed",
      plannedStartDate: "2026-06-01",
      plannedEndDate: "2026-06-28",
      durationWeeks: 3,
      weeksWithDataCount: 3,
    },
    metrics: {
      totalVolumeKg: 1,
      registeredExerciseCount: 1,
      weeklyVolumeKg: { 1: 1, 2: 1, 3: 1 },
      volumeProgress: {
        state: "increase",
        firstWeek: 1,
        lastWeek: 3,
        firstWeekVolume: 1,
        lastWeekVolume: 1,
        differenceKg: 0,
      },
      volumeProgressText: "Prueba de integración de estrés de celdas H1-E.2.2.",
    },
  };
}

const SIX_ENTRY_REPS = [10, 10, 10, 10];
// 10 valores: mezcla de repeticiones de un dígito (6,8,9,7) y de dos dígitos (10,11,12,13).
const TEN_REPS_SEQUENCE = [6, 8, 10, 12, 9, 11, 7, 13, 10, 12];
// 14 valores: mayoría de dos dígitos, uno de un dígito (9) y uno de tres dígitos (100).
const FOURTEEN_REPS_SEQUENCE = [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 9, 100];
// 20 valores: mezcla de uno/dos/tres dígitos (8, 12/13, 150).
const TWENTY_REPS_SEQUENCE = [8, 12, 12, 12, 12, 150, 12, 12, 9, 12, 12, 12, 11, 12, 13, 12, 10, 12, 12, 12];

/**
 * Modelo real con dos rutinas:
 * - "routine-registros": Uno(1)/Tres(3)/Cuatro(4)/Seis(6) registros + "Siguiente" al final, en un
 *   `weekBlocks: [[1, 2], [3]]` (dos bloques sucesivos, para confirmar semanas posteriores presentes).
 * - "routine-series-short": Series10Reps (tabla de UNA semana).
 * - "routine-series-long": Series14Reps + Series20Reps (tabla de DOS semanas) + marcador final.
 * Cada rutina usa un único weekBlock, para que cada nombre de ejercicio aparezca una sola vez en todo
 * el documento (evita ambigüedad al ubicar su fila real por nombre).
 */
function buildComprehensiveStressModel(): CycleHistoryPdfModel {
  return {
    ...buildStressModelBoilerplate(9, "Prueba de estrés de celdas"),
    routines: [
      {
        routineId: "routine-registros",
        routineName: "Rutina de conteo de registros",
        weekBlocks: [[1, 2], [3]],
        exercises: [
          { identity: { kind: "lineage", key: "lineage-uno" }, name: "Uno", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, SIX_ENTRY_REPS, 50) } },
          { identity: { kind: "lineage", key: "lineage-tres" }, name: "Tres", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 3, SIX_ENTRY_REPS, 50) } },
          { identity: { kind: "lineage", key: "lineage-cuatro" }, name: "Cuatro", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 4, SIX_ENTRY_REPS, 50) } },
          { identity: { kind: "lineage", key: "lineage-seis" }, name: "Seis", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 6, SIX_ENTRY_REPS, 50) } },
          { identity: { kind: "lineage", key: "lineage-siguiente" }, name: "Siguiente", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, [8, 8, 8], 45) } },
        ],
      },
      {
        routineId: "routine-series-short",
        routineName: "Rutina de repeticiones extensas (semana única)",
        weekBlocks: [[1]],
        exercises: [
          { identity: { kind: "lineage", key: "lineage-series10" }, name: "Series10Reps", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, TEN_REPS_SEQUENCE, 62.5) } },
          { identity: { kind: "lineage", key: "lineage-marcador-short" }, name: "MarcadorSeriesShort", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, [8, 8, 8], 45) } },
        ],
      },
      {
        routineId: "routine-series-long",
        routineName: "Rutina de repeticiones extensas (dos semanas)",
        weekBlocks: [[1, 2]],
        exercises: [
          { identity: { kind: "lineage", key: "lineage-series14" }, name: "Series14Reps", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, FOURTEEN_REPS_SEQUENCE, 70) } },
          { identity: { kind: "lineage", key: "lineage-series20" }, name: "Series20Reps", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, TWENTY_REPS_SEQUENCE, 55.5) } },
          { identity: { kind: "lineage", key: "lineage-marcador-long" }, name: "MarcadorSeriesLong", plan: null, weeks: { 1: buildIntegrationWeekRegistration(1, 1, [8, 8, 8], 45) } },
        ],
      },
    ],
  };
}

/**
 * Prueba de integración con jsPDF/jspdf-autotable REALES (no FakePdfDocument): verifica geometría
 * horizontal Y vertical real (izquierda/derecha/centrado dentro de `cell.x/width` real, sin cruce entre
 * líneas pareadas), conservación de datos, y ausencia de invasión de fila — para 1/3/4/6 registros y
 * para secuencias de repeticiones de 10/14/20 valores con variedad de dígitos y pesos.
 */
async function testComprehensiveStressGeometryAndDataIntegrity() {
  const { blob, textOps, geometryViolations } = await renderModelWithGeometryInstrumentation(buildComprehensiveStressModel());

  assert.ok(blob.size > 0, "debe generarse un PDF real no vacío");
  assert.deepEqual(
    geometryViolations,
    [],
    "ninguna operación de texto debe salirse de los límites reales de la celda (vertical, izquierda, derecha, centrado o cruce izquierda/derecha)",
  );

  const allTexts = textOps.map((operation) => operation.text);

  // Caso A: 6 registros — las 6 entradas conservan su orden y sus pesos, Total reps/Volumen total una vez.
  const seisIndex = allTexts.indexOf("Seis");
  const siguienteIndex = allTexts.indexOf("Siguiente");
  assert.ok(seisIndex >= 0 && siguienteIndex > seisIndex, "debe existir la fila 'Seis' antes de 'Siguiente'");
  const seisSlice = allTexts.slice(seisIndex, siguienteIndex);
  const seisWeights = seisSlice.filter((text) => text.startsWith("Peso: "));
  assert.deepEqual(
    seisWeights,
    [50, 55, 60, 65, 70, 75].map((weight) => `Peso: ${weight} kg`),
    "las 6 entradas deben conservar sus 6 pesos, en el mismo orden en que fueron registradas",
  );
  assert.equal(seisSlice.filter((text) => text.startsWith("Total reps: ")).length, 1, "Total reps debe aparecer una sola vez para 6 registros");
  assert.equal(seisSlice.filter((text) => text.startsWith("Volumen total: ")).length, 1, "Volumen total debe aparecer una sola vez para 6 registros");

  // Casos B/C/D: 10/14/20 valores de repeticiones — ninguno se pierde, ninguno se reordena.
  assertRepsSequencePreserved(allTexts, "Series10Reps", "MarcadorSeriesShort", TEN_REPS_SEQUENCE);
  assertRepsSequencePreserved(allTexts, "Series14Reps", "Series20Reps", FOURTEEN_REPS_SEQUENCE);
  assertRepsSequencePreserved(allTexts, "Series20Reps", "MarcadorSeriesLong", TWENTY_REPS_SEQUENCE);

  // Ninguna fila marcadora queda invadida por el contenido de las filas anteriores.
  assertNoRowInvasion(textOps, allTexts, "Siguiente");
  assertNoRowInvasion(textOps, allTexts, "MarcadorSeriesShort");
  assertNoRowInvasion(textOps, allTexts, "MarcadorSeriesLong");

  // Headers/footers y la semana posterior (bloque [3] sin datos) siguen presentes.
  assert.ok(allTexts.includes("Organizatech"));
  assert.ok(allTexts.some((text) => text.startsWith("Página ")));
  assert.ok(allTexts.some((text) => text.includes("Semana 3")), "la semana posterior (bloque [3]) debe seguir presente");
}

/**
 * Modelo con muchas filas simples ("filler") para acercar deliberadamente una fila extensa (6
 * registros) al límite inferior de una página, seguida de una fila marcadora final — para ejercitar
 * `rowPageBreak: "avoid"` en un escenario realista de salto de página.
 */
function buildNearPageBreakModel(): CycleHistoryPdfModel {
  const fillerExercises = Array.from({ length: 15 }, (_, index) => ({
    identity: { kind: "lineage" as const, key: `lineage-filler-${index}` },
    name: `Filler${index + 1}`,
    plan: null,
    weeks: { 1: buildIntegrationWeekRegistration(1, 1, [10, 10, 10], 40 + index) },
  }));

  return {
    ...buildStressModelBoilerplate(11, "Prueba de salto de página"),
    routines: [
      {
        routineId: "routine-page-break",
        routineName: "Rutina cercana al salto de página",
        weekBlocks: [[1]],
        exercises: [
          ...fillerExercises,
          {
            identity: { kind: "lineage", key: "lineage-extensivo" },
            name: "ExtensivoCercaDelBorde",
            plan: null,
            weeks: { 1: buildIntegrationWeekRegistration(1, 6, SIX_ENTRY_REPS, 50) },
          },
          {
            identity: { kind: "lineage", key: "lineage-marcador-final" },
            name: "MarcadorFinal",
            plan: null,
            weeks: { 1: buildIntegrationWeekRegistration(1, 1, [8, 8, 8], 45) },
          },
        ],
      },
    ],
  };
}

/**
 * Caso cercano al final de página: confirma que `rowPageBreak: "avoid"` sigue moviendo/manteniendo la
 * fila extensa según corresponda, que el contenido custom no se repite entre páginas, que la fila
 * siguiente no queda invadida, que no hay páginas vacías, y que headers/footers siguen intactos.
 */
async function testNearPageBreakRowHandledCorrectlyWithoutOverlapOrEmptyPages() {
  const { blob, textOps, geometryViolations } = await renderModelWithGeometryInstrumentation(buildNearPageBreakModel());

  assert.ok(blob.size > 0, "debe generarse un PDF real no vacío");
  assert.deepEqual(geometryViolations, [], "ninguna operación de texto debe salirse de los límites reales de la celda");

  const allTexts = textOps.map((operation) => operation.text);
  assertNoRowInvasion(textOps, allTexts, "MarcadorFinal");

  const extensivoIndex = allTexts.indexOf("ExtensivoCercaDelBorde");
  const marcadorIndex = allTexts.indexOf("MarcadorFinal");
  assert.ok(extensivoIndex >= 0 && marcadorIndex > extensivoIndex);
  const extensivoSlice = allTexts.slice(extensivoIndex, marcadorIndex);
  assert.equal(
    extensivoSlice.filter((text) => text.startsWith("Total reps: ")).length,
    1,
    "rowPageBreak: avoid no debe hacer que el contenido custom se repita entre páginas (Total reps una sola vez)",
  );
  assert.equal(
    extensivoSlice.filter((text) => text.startsWith("Volumen total: ")).length,
    1,
    "Volumen total una sola vez, sin repetirse por paginación",
  );

  const pageCount = Math.max(...textOps.map((operation) => operation.page));
  assert.ok(pageCount >= 1);
  for (let page = 1; page <= pageCount; page += 1) {
    const pageTexts = textOps.filter((operation) => operation.page === page).map((operation) => operation.text);
    const hasBodyText = pageTexts.some(
      (text) => text !== "Organizatech" && text !== "Historial de ciclo de entrenamiento" && !text.startsWith("Generado:") && !text.startsWith("Página "),
    );
    assert.ok(hasBodyText, `la página ${page} no debe quedar vacía`);
  }

  assert.ok(allTexts.some((text) => text.startsWith("Página ")), "el footer con numeración de página debe seguir presente");
}

/**
 * Documenta empíricamente, con AutoTable REAL (no asumido), qué reporta `data.cell.width` para una
 * columna de semana durante `didParseCell` frente a `didDrawCell`. No afirma un valor específico (0 u
 * otro): solo confirma que la lógica productiva NO depende de él — `minCellHeight` se fija a un valor
 * real, finito y positivo en cada celda observada, calculado desde el ancho de columna conocido por
 * closure (`weekColumnWidths`), sin importar qué reporte `data.cell.width` en esa fase.
 */
async function testDataCellWidthDuringDidParseCellDoesNotDetermineProductionBehavior() {
  const { jsPDF } = await import("jspdf");
  const { autoTable: realAutoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", putOnlyUsedFonts: true, compress: true });
  instrumentRealDocumentText(doc);

  const observations: Array<{ phase: "parse" | "draw"; columnIndex: number; cellWidth: number }> = [];
  const minCellHeights: number[] = [];

  const blob = renderCycleHistoryPdfWithDependencies(buildCycleHistoryPdfTestModel(), {
    createDocument: () => doc as unknown as CycleHistoryPdfDocumentLike,
    autoTable: (_fakeDocument, options) => {
      const originalDidParseCell = options.didParseCell;
      const originalDidDrawCell = options.didDrawCell;
      const wrappedOptions = {
        ...options,
        didParseCell: (data: CycleHistoryPdfCellHookData) => {
          const isWeekColumn = data.column.index >= 2 && typeof data.cell.raw === "object" && data.cell.raw !== null;
          if (isWeekColumn) observations.push({ phase: "parse", columnIndex: data.column.index, cellWidth: data.cell.width });
          originalDidParseCell(data);
          if (isWeekColumn && typeof data.cell.styles.minCellHeight === "number") {
            minCellHeights.push(data.cell.styles.minCellHeight);
          }
        },
        didDrawCell: (data: CycleHistoryPdfCellHookData) => {
          if (data.column.index >= 2) observations.push({ phase: "draw", columnIndex: data.column.index, cellWidth: data.cell.width });
          originalDidDrawCell(data);
        },
      };
      (realAutoTable as unknown as (document: unknown, options: unknown) => void)(doc, wrappedOptions);
    },
  });

  assert.ok(blob.size > 0, "debe generarse un PDF real no vacío");

  const parseObservations = observations.filter((observation) => observation.phase === "parse");
  const drawObservations = observations.filter((observation) => observation.phase === "draw");
  assert.ok(parseObservations.length > 0, "debe observarse al menos una celda de semana en didParseCell");
  assert.ok(drawObservations.length > 0, "debe observarse al menos una celda de semana en didDrawCell");

  // Documentación empírica (no una aserción de un valor específico): quedan registrados en consola los
  // valores reales que reportan las versiones instaladas de jsPDF/jspdf-autotable en cada fase.
  console.log(
    `[H1-E.2.2] data.cell.width observado — didParseCell: ${JSON.stringify(parseObservations.map((observation) => observation.cellWidth))}, ` +
      `didDrawCell: ${JSON.stringify(drawObservations.map((observation) => observation.cellWidth))}`,
  );

  // La lógica productiva NO depende de un valor específico de data.cell.width durante didParseCell:
  // minCellHeight queda fijado a un valor real, finito y positivo en cada celda observada, sin importar
  // qué haya reportado data.cell.width en esa fase (0, un provisional, o cualquier otro valor).
  assert.ok(minCellHeights.length > 0, "debe haberse fijado minCellHeight en al menos una celda de semana");
  for (const height of minCellHeights) {
    assert.ok(Number.isFinite(height) && height > 0, `minCellHeight debe ser un número finito y positivo (obtenido: ${height})`);
  }
}

function testRendererUsesOnlyDynamicPdfImportsAndNoHtmlRasterization() {
  const source = readFileSync(
    "src/lib/training/cycle-history/cycle-history-pdf-renderer.ts",
    "utf8",
  );
  assert.match(source, /import\("jspdf"\)/);
  assert.match(source, /import\("jspdf-autotable"\)/);
  assert.doesNotMatch(source, /from\s+["']jspdf["']/);
  assert.doesNotMatch(source, /from\s+["']jspdf-autotable["']/);
  assert.doesNotMatch(source, /html2canvas|\.html\(|addJS\(|addImage\(/);
}

async function run() {
  testRenderUsesLandscapeA4TablesAndEveryPageFooters();
  testEmptyModelDoesNotRenderTablesOrExtraPages();
  testSingleEntryWeekKeepsCompactFormatWithoutRegressions();
  testTwoEntryWeekReservesSufficientHeight();
  testThreeEntryWeekKeepsLastLineWithinBottomBorder();
  testFourEntryWeekKeepsTotalWithinCellAndAvoidsRowInvasion();
  testManySeriesEntryWrapsWithoutLosingRepsAndKeepsAlignment();
  testPlainCellsAreUntouchedByCustomWeekDrawing();
  await testComprehensiveStressGeometryAndDataIntegrity();
  await testNearPageBreakRowHandledCorrectlyWithoutOverlapOrEmptyPages();
  await testDataCellWidthDuringDidParseCellDoesNotDetermineProductionBehavior();
  testRendererUsesOnlyDynamicPdfImportsAndNoHtmlRasterization();

  console.log("cycle-history-pdf-renderer tests passed");
}

void run();
