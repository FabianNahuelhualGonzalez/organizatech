import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  renderCycleHistoryPdfWithDependencies,
  type CycleHistoryAutoTableOptions,
  type CycleHistoryPdfDocumentLike,
  type CycleHistoryPdfDocumentOptions,
} from "@/lib/training/cycle-history/cycle-history-pdf-renderer";
import { buildCycleHistoryPdfTestModel } from "@/lib/training/cycle-history/cycle-history-pdf-test-fixtures";

interface TextOperation {
  page: number;
  text: string;
}

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

  splitTextToSize(text: string) {
    return text.split("\n");
  }

  text(value: string | string[]) {
    this.textOperations.push({
      page: this.currentPage,
      text: Array.isArray(value) ? value.join("\n") : value,
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

testRenderUsesLandscapeA4TablesAndEveryPageFooters();
testEmptyModelDoesNotRenderTablesOrExtraPages();
testRendererUsesOnlyDynamicPdfImportsAndNoHtmlRasterization();

console.log("cycle-history-pdf-renderer tests passed");
