import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import {
  buildCycleHistoryPdfPresentation,
  type CycleHistoryPdfField,
  type CycleHistoryPdfTablePresentation,
} from "@/lib/training/cycle-history/cycle-history-pdf-presentation";

const PAGE_MARGIN = 14;
const CONTENT_TOP = 25;
const CONTENT_BOTTOM = 18;
const HEADER_LINE_Y = 19;
const BRAND_BLUE: [number, number, number] = [60, 122, 255];
const DARK_BLUE: [number, number, number] = [31, 42, 53];
const TEXT_BLACK: [number, number, number] = [20, 24, 31];
const LINE_GREY: [number, number, number] = [190, 197, 207];

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
  text(text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }): unknown;
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
  lastAutoTable?: { finalY?: number };
}

export interface CycleHistoryAutoTableOptions {
  startY: number;
  head: string[][];
  body: string[][];
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
  table.weeks.forEach((_, index) => {
    columnStyles[index + 2] = { cellWidth: weekWidth };
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
  });
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
