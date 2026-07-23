import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import {
  buildCycleHistoryPdfPresentation,
  type CycleHistoryPdfCellValue,
  type CycleHistoryPdfField,
  type CycleHistoryPdfTablePresentation,
  type CycleHistoryPdfWeekCellRow,
  type CycleHistoryPdfWeekRegistrationCell,
} from "@/lib/training/cycle-history/cycle-history-pdf-presentation";

const PAGE_MARGIN = 14;
const CONTENT_TOP = 25;
const CONTENT_BOTTOM = 18;
const HEADER_LINE_Y = 19;
const BRAND_BLUE: [number, number, number] = [60, 122, 255];
const DARK_BLUE: [number, number, number] = [31, 42, 53];
const TEXT_BLACK: [number, number, number] = [20, 24, 31];
const LINE_GREY: [number, number, number] = [190, 197, 207];

/**
 * 1 punto tipográfico = 1/72 de pulgada = 25.4/72 mm. Es una conversión física fija (no una
 * propiedad interna de jsPDF/autoTable), necesaria porque `setFontSize` trabaja en puntos mientras
 * el documento usa milímetros como unidad.
 */
const MM_PER_POINT = 25.4 / 72;
const WEEK_CELL_ROW_FONT_SIZE = 7.5;
const WEEK_CELL_TOTAL_FONT_SIZE = 8;
const WEEK_CELL_LINE_HEIGHT_FACTOR = 1.15;
const WEEK_CELL_ROW_LINE_HEIGHT_MM = WEEK_CELL_ROW_FONT_SIZE * MM_PER_POINT * WEEK_CELL_LINE_HEIGHT_FACTOR;
const WEEK_CELL_TOTAL_LINE_HEIGHT_MM = WEEK_CELL_TOTAL_FONT_SIZE * MM_PER_POINT * WEEK_CELL_LINE_HEIGHT_FACTOR;
const WEEK_CELL_GAP_BEFORE_TOTAL_MM = WEEK_CELL_ROW_LINE_HEIGHT_MM * 0.5;
const WEEK_CELL_MIN_HORIZONTAL_GAP_MM = 3;
const WEEK_CELL_FIRST_COLUMN_INDEX = 2;

export interface CycleHistoryPdfDocumentOptions {
  orientation: "landscape";
  unit: "mm";
  format: "a4";
  putOnlyUsedFonts: true;
  compress: true;
}

export interface CycleHistoryPdfDocumentLike {
  addPage(): unknown;
  getCurrentPageInfo(): { pageNumber: number };
  getNumberOfPages(): number;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  output(type: "blob"): Blob;
  setDrawColor(red: number, green: number, blue: number): unknown;
  setFont(name: string, style?: string): unknown;
  setFontSize(size: number): unknown;
  setLineWidth(width: number): unknown;
  setPage(pageNumber: number): unknown;
  setProperties(properties: { title: string; subject: string; creator: string }): unknown;
  setTextColor(red: number, green: number, blue: number): unknown;
  splitTextToSize(text: string, maxWidth: number): string[];
  getTextWidth(text: string): number;
  text(text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }): unknown;
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
  lastAutoTable?: { finalY?: number };
}

/** Subconjunto de la celda real de jspdf-autotable que necesitamos leer/escribir en los hooks de dibujo. */
export interface CycleHistoryPdfCellHookCell {
  raw: unknown;
  text: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  styles: { cellPadding: number; minCellHeight?: number };
}

export interface CycleHistoryPdfCellHookData {
  cell: CycleHistoryPdfCellHookCell;
  column: { index: number };
}

export interface CycleHistoryAutoTableOptions {
  startY: number;
  head: string[][];
  body: CycleHistoryPdfCellValue[][];
  theme: "grid";
  showHead: "everyPage";
  rowPageBreak: "avoid";
  pageBreak: "auto";
  margin: { top: number; right: number; bottom: number; left: number };
  tableWidth: number;
  styles: Record<string, unknown>;
  headStyles: Record<string, unknown>;
  alternateRowStyles: Record<string, unknown>;
  columnStyles: Record<number, Record<string, unknown>>;
  willDrawPage(): void;
  didParseCell(data: CycleHistoryPdfCellHookData): void;
  didDrawCell(data: CycleHistoryPdfCellHookData): void;
}

export interface CycleHistoryPdfRenderDependencies {
  createDocument(options: CycleHistoryPdfDocumentOptions): CycleHistoryPdfDocumentLike;
  autoTable(document: CycleHistoryPdfDocumentLike, options: CycleHistoryAutoTableOptions): void;
}

export async function renderCycleHistoryPdf(model: CycleHistoryPdfModel): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  return renderCycleHistoryPdfWithDependencies(model, {
    createDocument: (options) => new jsPDF(options) as unknown as CycleHistoryPdfDocumentLike,
    autoTable: autoTable as unknown as CycleHistoryPdfRenderDependencies["autoTable"],
  });
}

export function renderCycleHistoryPdfWithDependencies(
  model: CycleHistoryPdfModel,
  dependencies: CycleHistoryPdfRenderDependencies,
): Blob {
  const presentation = buildCycleHistoryPdfPresentation(model);
  const document = dependencies.createDocument({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    putOnlyUsedFonts: true,
    compress: true,
  });
  const headerPages = new Set<number>();

  document.setProperties({
    title: "Historial de ciclo de entrenamiento",
    subject: "Resumen de ciclo de entrenamiento",
    creator: "Organizatech",
  });
  drawPageHeader(document, headerPages);

  let cursorY = CONTENT_TOP;
  cursorY = drawWrappedText(document, presentation.documentTitle, cursorY, {
    fontSize: 15,
    fontStyle: "bold",
    color: DARK_BLUE,
    gapAfter: 5,
  }, headerPages);
  cursorY = drawFieldSection(document, "Resumen del ciclo", presentation.cycleFields, cursorY, headerPages);
  if (presentation.personalFields.length > 0) {
    cursorY = drawFieldSection(document, "Datos personales", presentation.personalFields, cursorY, headerPages);
  }
  cursorY = drawFieldSection(document, "Métricas", presentation.metricFields, cursorY, headerPages);

  if (presentation.emptyMessage) {
    cursorY = drawWrappedText(document, presentation.emptyMessage, cursorY + 2, {
      fontSize: 10,
      fontStyle: "normal",
      color: TEXT_BLACK,
      gapAfter: 4,
    }, headerPages);
  }

  for (const routine of presentation.routines) {
    if (routine.tables.length === 0) continue;
    cursorY = ensureSpace(document, cursorY, 48, headerPages);
    cursorY = drawWrappedText(document, routine.routineName, cursorY, {
      fontSize: 12,
      fontStyle: "bold",
      color: DARK_BLUE,
      gapAfter: 3,
    }, headerPages);

    for (const table of routine.tables) {
      cursorY = ensureSpace(document, cursorY, 36, headerPages);
      cursorY = drawWrappedText(document, buildWeekBlockLabel(table.weeks), cursorY, {
        fontSize: 9,
        fontStyle: "bold",
        color: BRAND_BLUE,
        gapAfter: 2,
      }, headerPages);
      drawRoutineTable(document, dependencies.autoTable, table, cursorY, headerPages);
      cursorY = (document.lastAutoTable?.finalY ?? cursorY) + 7;
    }
  }

  addPageFooters(document, presentation.generatedAtLabel);
  const blob = document.output("blob");
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("La generación PDF no produjo un archivo válido.");
  }
  return blob;
}

function drawFieldSection(
  document: CycleHistoryPdfDocumentLike,
  title: string,
  fields: CycleHistoryPdfField[],
  initialY: number,
  headerPages: Set<number>,
): number {
  if (fields.length === 0) return initialY;
  let cursorY = ensureSpace(document, initialY, 12, headerPages);
  cursorY = drawWrappedText(document, title, cursorY, {
    fontSize: 11,
    fontStyle: "bold",
    color: BRAND_BLUE,
    gapAfter: 2,
  }, headerPages);

  for (const field of fields) {
    cursorY = drawField(document, field, cursorY, headerPages);
  }
  return cursorY + 3;
}

function drawField(
  document: CycleHistoryPdfDocumentLike,
  field: CycleHistoryPdfField,
  initialY: number,
  headerPages: Set<number>,
): number {
  const contentWidth = document.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const labelWidth = 52;
  const valueLines = document.splitTextToSize(field.value, contentWidth - labelWidth);
  const lineHeight = 4.2;
  const requiredHeight = Math.max(1, valueLines.length) * lineHeight + 1;
  const cursorY = ensureSpace(document, initialY, requiredHeight, headerPages);

  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.setTextColor(...TEXT_BLACK);
  document.text(`${field.label}:`, PAGE_MARGIN, cursorY);
  document.setFont("helvetica", "normal");
  document.text(valueLines, PAGE_MARGIN + labelWidth, cursorY);
  return cursorY + requiredHeight;
}

function drawWrappedText(
  document: CycleHistoryPdfDocumentLike,
  text: string,
  initialY: number,
  style: {
    fontSize: number;
    fontStyle: "normal" | "bold";
    color: [number, number, number];
    gapAfter: number;
  },
  headerPages: Set<number>,
): number {
  const width = document.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const lines = document.splitTextToSize(text, width);
  const lineHeight = style.fontSize * 0.42;
  const requiredHeight = Math.max(1, lines.length) * lineHeight;
  const cursorY = ensureSpace(document, initialY, requiredHeight, headerPages);
  document.setFont("helvetica", style.fontStyle);
  document.setFontSize(style.fontSize);
  document.setTextColor(...style.color);
  document.text(lines, PAGE_MARGIN, cursorY);
  return cursorY + requiredHeight + style.gapAfter;
}

function drawRoutineTable(
  document: CycleHistoryPdfDocumentLike,
  autoTable: CycleHistoryPdfRenderDependencies["autoTable"],
  table: CycleHistoryPdfTablePresentation,
  startY: number,
  headerPages: Set<number>,
) {
  const tableWidth = document.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const fixedWidth = table.weeks.length === 1 ? 112 : 97;
  const weekWidth = (tableWidth - fixedWidth) / table.weeks.length;
  const columnStyles: Record<number, Record<string, unknown>> = {
    0: { cellWidth: 42 },
    1: { cellWidth: table.weeks.length === 1 ? 70 : 55 },
  };
  const weekColumnWidths = new Map<number, number>();
  table.weeks.forEach((_, index) => {
    columnStyles[index + 2] = { cellWidth: weekWidth };
    weekColumnWidths.set(index + 2, weekWidth);
  });

  autoTable(document, {
    startY,
    head: [table.head],
    body: table.rows,
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    pageBreak: "auto",
    margin: { top: CONTENT_TOP, right: PAGE_MARGIN, bottom: CONTENT_BOTTOM, left: PAGE_MARGIN },
    tableWidth,
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      textColor: TEXT_BLACK,
      lineColor: LINE_GREY,
      lineWidth: 0.15,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: DARK_BLUE,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      lineColor: LINE_GREY,
    },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles,
    willDrawPage: () => drawPageHeader(document, headerPages),
    didParseCell: (data) => handleWeekRegistrationCellParse(document, data, weekColumnWidths),
    didDrawCell: (data) => drawWeekRegistrationCell(document, data, weekColumnWidths),
  });
}

function isWeekRegistrationCell(raw: unknown): raw is CycleHistoryPdfWeekRegistrationCell {
  return typeof raw === "object" && raw !== null && (raw as { kind?: unknown }).kind === "registration";
}

/** Una línea física ya resuelta para dibujar: izquierda y/o derecha, o ambas si comparten la línea. */
interface CycleHistoryPdfWeekCellLine {
  left: string | null;
  right: string | null;
}

/**
 * Layout ya resuelto de una celda de semana: las líneas físicas a dibujar (una por fila, o varias si
 * el contenido se envuelve), las líneas del total, y el alto de contenido total en mm que ambas
 * ocupan. Es la ÚNICA fuente de verdad: `didParseCell` reserva exactamente `contentHeight` y
 * `didDrawCell` dibuja exactamente las mismas `lines`/`totalLines` con la misma altura por línea, por
 * lo que nunca pueden divergir entre sí.
 */
interface CycleHistoryPdfWeekCellLayout {
  lines: CycleHistoryPdfWeekCellLine[];
  totalLines: string[];
  contentHeight: number;
}

/**
 * Divide un texto en tokens conservando su separador ("Repeticiones: ", "12/", "12/", "12"), para
 * envolver por palabra/serie en vez de por carácter arbitrario — `splitTextToSize` real de jsPDF
 * solo reconoce el espacio como punto de corte y puede partir un número por la mitad (confirmado:
 * una cadena "12/12/12/..." sin espacios se corta en cualquier carácter). Aquí también tratamos "/"
 * como punto de corte válido, para que ninguna repetición quede partida entre dos líneas.
 */
function tokenizeForWrap(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const character of text) {
    current += character;
    if (character === " " || character === "/") {
      tokens.push(current);
      current = "";
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Envuelve `text` en líneas que caben en `maxWidth`, cortando solo en espacios o "/" (nunca en medio
 * de un número o palabra). Si un único token no cabe ni en una línea vacía (caso extremo), recurre al
 * `splitTextToSize` real de jsPDF como último recurso para no perder contenido — nunca se recorta ni
 * se elimina texto, en el peor caso solo se ve menos prolijo.
 */
function wrapTextToWidth(document: CycleHistoryPdfDocumentLike, text: string, maxWidth: number): string[] {
  const tokens = tokenizeForWrap(text);
  const lines: string[] = [];
  let currentLine = "";

  const startNewLineWith = (token: string) => {
    if (document.getTextWidth(token) <= maxWidth) {
      currentLine = token;
      return;
    }
    const forced = document.splitTextToSize(token, maxWidth);
    lines.push(...forced.slice(0, -1));
    currentLine = forced[forced.length - 1] ?? "";
  };

  for (const token of tokens) {
    if (currentLine.length === 0) {
      startNewLineWith(token);
      continue;
    }
    const candidate = currentLine + token;
    if (document.getTextWidth(candidate) <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = "";
      startNewLineWith(token);
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

/**
 * Envuelve una fila lógica ("Series registradas"/"Peso" o "Repeticiones"/"Total reps") en una o más
 * líneas físicas. Si izquierda y derecha caben juntas en el ancho disponible (con un margen mínimo
 * entre ambas) comparten una única línea; si no, ocupan líneas consecutivas conservando su
 * alineación — nunca se recortan ni se pierde texto, y nunca se cruzan entre sí.
 */
function wrapWeekCellRow(
  document: CycleHistoryPdfDocumentLike,
  row: CycleHistoryPdfWeekCellRow,
  availableWidth: number,
): CycleHistoryPdfWeekCellLine[] {
  document.setFont("helvetica", "normal");
  document.setFontSize(WEEK_CELL_ROW_FONT_SIZE);
  const leftLines = wrapTextToWidth(document, row.left, availableWidth);

  if (row.right === null) {
    return leftLines.map((text) => ({ left: text, right: null }));
  }

  if (leftLines.length === 1) {
    const leftText = leftLines[0] ?? "";
    const leftWidth = document.getTextWidth(leftText);
    const rightWidth = document.getTextWidth(row.right);
    if (leftWidth + rightWidth + WEEK_CELL_MIN_HORIZONTAL_GAP_MM <= availableWidth) {
      return [{ left: leftText, right: row.right }];
    }
  }

  return [...leftLines.map((text) => ({ left: text, right: null })), { left: null, right: row.right }];
}

/**
 * Fuente única de verdad del layout de una celda de semana: calcula tanto las líneas físicas a
 * dibujar como el alto de contenido exacto que ocuparán, usando el mismo alto de línea
 * (`WEEK_CELL_ROW_LINE_HEIGHT_MM`/`WEEK_CELL_TOTAL_LINE_HEIGHT_MM`) para ambos cálculos. Llamarla dos
 * veces con los mismos `cell`/`availableWidth` (una en `didParseCell`, otra en `didDrawCell`) siempre
 * produce el mismo resultado — no hay una constante independiente que pueda divergir.
 */
function computeWeekRegistrationCellLayout(
  document: CycleHistoryPdfDocumentLike,
  cell: CycleHistoryPdfWeekRegistrationCell,
  availableWidth: number,
): CycleHistoryPdfWeekCellLayout {
  const lines = cell.rows.flatMap((row) => wrapWeekCellRow(document, row, availableWidth));

  document.setFont("helvetica", "bold");
  document.setFontSize(WEEK_CELL_TOTAL_FONT_SIZE);
  const totalLines = wrapTextToWidth(document, cell.totalLine, availableWidth);

  const contentHeight =
    lines.length * WEEK_CELL_ROW_LINE_HEIGHT_MM +
    WEEK_CELL_GAP_BEFORE_TOTAL_MM +
    totalLines.length * WEEK_CELL_TOTAL_LINE_HEIGHT_MM;

  return { lines, totalLines, contentHeight };
}

/**
 * `data.cell.width` durante `didParseCell` no refleja de forma fiable el ancho final de columna: con
 * las versiones instaladas (jsPDF 4.2.1 / jspdf-autotable 5.0.8) se observó consistentemente en 0 en
 * esa fase, mientras que en `didDrawCell` (para la misma columna) refleja el ancho real ya resuelto —
 * ver `testDataCellWidthDuringDidParseCellDoesNotDetermineProductionBehavior` en el test de este
 * renderer, que documenta el valor observado empíricamente sin asumirlo como garantía de la librería.
 * Por eso el código productivo NUNCA depende de `data.cell.width` en `didParseCell`: el ancho de
 * columna configurado (`weekColumnWidths`, calculado una sola vez en `drawRoutineTable`) es la única
 * fuente de verdad para la decisión de envolvido/alto en AMBOS hooks, sin importar qué reporte
 * `data.cell.width` en esa fase. `data.cell.width` real (correcto en `didDrawCell`) solo se usa para la
 * posición final de dibujo, nunca para decidir cuánto envolver.
 */
function resolveWeekCellAvailableWidth(
  data: CycleHistoryPdfCellHookData,
  weekColumnWidths: ReadonlyMap<number, number>,
  padding: number,
): number {
  const columnWidth = weekColumnWidths.get(data.column.index) ?? data.cell.width;
  return columnWidth - padding * 2;
}

/**
 * Vaciamos el texto por defecto de la celda de semana (el contenido real se dibuja aparte, ver
 * `drawWeekRegistrationCell`) y forzamos el alto mínimo real vía `minCellHeight` — el mismo valor que
 * `drawWeekRegistrationCell` usará para dibujar, calculado por la misma función con el mismo ancho.
 * autoTable reserva `max(minCellHeight, alto-por-texto)`; al vaciar el texto el alto-por-texto es ~0,
 * así que `minCellHeight` manda, garantizando que la fila siguiente nunca se superponga sin importar
 * cuántos registros tenga la semana.
 */
function handleWeekRegistrationCellParse(
  document: CycleHistoryPdfDocumentLike,
  data: CycleHistoryPdfCellHookData,
  weekColumnWidths: ReadonlyMap<number, number>,
) {
  if (data.column.index < WEEK_CELL_FIRST_COLUMN_INDEX) return;
  if (!isWeekRegistrationCell(data.cell.raw)) return;

  const padding = data.cell.styles.cellPadding ?? 2;
  const availableWidth = resolveWeekCellAvailableWidth(data, weekColumnWidths, padding);
  const layout = computeWeekRegistrationCellLayout(document, data.cell.raw, availableWidth);

  data.cell.text = [];
  data.cell.styles.minCellHeight = layout.contentHeight + padding * 2;
}

/** Dibuja el contenido real de una celda de semana: filas izquierda/derecha pareadas + total centrado. */
function drawWeekRegistrationCell(
  document: CycleHistoryPdfDocumentLike,
  data: CycleHistoryPdfCellHookData,
  weekColumnWidths: ReadonlyMap<number, number>,
) {
  if (data.column.index < WEEK_CELL_FIRST_COLUMN_INDEX) return;
  const raw = data.cell.raw;
  if (!isWeekRegistrationCell(raw)) return;

  const padding = data.cell.styles.cellPadding ?? 2;
  const availableWidth = resolveWeekCellAvailableWidth(data, weekColumnWidths, padding);
  const layout = computeWeekRegistrationCellLayout(document, raw, availableWidth);

  const leftX = data.cell.x + padding;
  const rightX = data.cell.x + data.cell.width - padding;
  const centerX = data.cell.x + data.cell.width / 2;
  let lineY = data.cell.y + padding + WEEK_CELL_ROW_LINE_HEIGHT_MM * 0.75;

  document.setFont("helvetica", "normal");
  document.setFontSize(WEEK_CELL_ROW_FONT_SIZE);
  document.setTextColor(...TEXT_BLACK);
  for (const line of layout.lines) {
    if (line.left !== null) document.text(line.left, leftX, lineY);
    if (line.right !== null) document.text(line.right, rightX, lineY, { align: "right" });
    lineY += WEEK_CELL_ROW_LINE_HEIGHT_MM;
  }

  lineY += WEEK_CELL_GAP_BEFORE_TOTAL_MM;
  document.setFont("helvetica", "bold");
  document.setFontSize(WEEK_CELL_TOTAL_FONT_SIZE);
  document.setTextColor(...TEXT_BLACK);
  for (const totalLineText of layout.totalLines) {
    document.text(totalLineText, centerX, lineY, { align: "center" });
    lineY += WEEK_CELL_TOTAL_LINE_HEIGHT_MM;
  }
}

function ensureSpace(
  document: CycleHistoryPdfDocumentLike,
  cursorY: number,
  requiredHeight: number,
  headerPages: Set<number>,
): number {
  const pageHeight = document.internal.pageSize.getHeight();
  if (cursorY + requiredHeight <= pageHeight - CONTENT_BOTTOM) return cursorY;
  document.addPage();
  drawPageHeader(document, headerPages);
  return CONTENT_TOP;
}

function drawPageHeader(document: CycleHistoryPdfDocumentLike, headerPages: Set<number>) {
  const pageNumber = document.getCurrentPageInfo().pageNumber;
  if (headerPages.has(pageNumber)) return;
  headerPages.add(pageNumber);

  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.setTextColor(...BRAND_BLUE);
  document.text("Organizatech", PAGE_MARGIN, 8);
  document.setFontSize(12);
  document.setTextColor(...DARK_BLUE);
  document.text("Historial de ciclo de entrenamiento", PAGE_MARGIN, 15);
  document.setDrawColor(...LINE_GREY);
  document.setLineWidth(0.25);
  document.line(PAGE_MARGIN, HEADER_LINE_Y, document.internal.pageSize.getWidth() - PAGE_MARGIN, HEADER_LINE_Y);
}

function addPageFooters(document: CycleHistoryPdfDocumentLike, generatedAtLabel: string | null) {
  const totalPages = document.getNumberOfPages();
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  for (let page = 1; page <= totalPages; page += 1) {
    document.setPage(page);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.setTextColor(95, 103, 116);
    if (generatedAtLabel) {
      document.text(`Generado: ${generatedAtLabel}`, PAGE_MARGIN, pageHeight - 7);
    }
    document.text(`Página ${page} de ${totalPages}`, pageWidth - PAGE_MARGIN, pageHeight - 7, {
      align: "right",
    });
  }
}

function buildWeekBlockLabel(weeks: number[]): string {
  return weeks.length === 1
    ? `Semana ${weeks[0]}`
    : `Semanas ${weeks.join(" y ")}`;
}
