import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { jsPDF } from "jspdf";
import { MAX_MEDICAL_DOCUMENT_BYTES, verifyMedicalDocument } from "./verify-medical-document";

test("real PDF parses; forged magic, wrong MIME, truncation and >25 MiB fail", () => {
  const temp = mkdtempSync(join(tmpdir(), "org-medical-pdf-"));
  const oldPath = process.env.PATH;
  try {
    // CI workers use Poppler. macOS development hosts can validate with native PDFKit.
    try { execFileSync("pdfinfo", ["-v"], { stdio: "ignore" }); }
    catch {
      if (process.platform !== "darwin") throw new Error("pdfinfo_required_for_pdf_contract");
      const source = join(temp, "pdfinfo.swift");
      const target = join(temp, "pdfinfo");
      writeFileSync(source, `import Foundation
import PDFKit
let bytes = FileHandle.standardInput.readDataToEndOfFile()
guard let pdf = PDFDocument(data: bytes), pdf.pageCount > 0 else { exit(1) }
print("Pages: \\(pdf.pageCount)")
print("Encrypted: \\(pdf.isEncrypted ? "yes" : "no")")
print("JavaScript: no")
`);
      execFileSync("swiftc", [source, "-o", target], { timeout: 120000, stdio: "ignore" });
      chmodSync(target, 0o700);
      process.env.PATH = `${temp}:${oldPath ?? ""}`;
    }
    const real = new Uint8Array(new jsPDF().output("arraybuffer"));
    assert.equal(verifyMedicalDocument(real, "application/pdf").pageCount, 1);
    assert.throws(() => verifyMedicalDocument(real, "text/plain"), /invalid_pdf/);
    assert.throws(() => verifyMedicalDocument(new TextEncoder().encode("%PDF-1.7\nnot a PDF\n%%EOF"),
      "application/pdf"), /invalid_pdf/);
    assert.throws(() => verifyMedicalDocument(real.subarray(0, 80), "application/pdf"), /invalid_pdf/);
    assert.throws(() => verifyMedicalDocument(new Uint8Array(MAX_MEDICAL_DOCUMENT_BYTES + 1),
      "application/pdf"), /invalid_pdf/);
  } finally {
    process.env.PATH = oldPath;
    rmSync(temp, { recursive: true, force: true });
  }
});
