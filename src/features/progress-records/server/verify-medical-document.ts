import { execFileSync } from "node:child_process";

export const MAX_MEDICAL_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Check the host before claiming a queued document. A missing parser must not
// turn a valid upload into a failed reservation scheduled for cleanup.
export function assertMedicalDocumentParserAvailable(): void {
  try {
    execFileSync("pdfinfo", ["-v"], { timeout: 5000, stdio: "ignore" });
  } catch {
    throw new Error("medical_document_pdfinfo_unavailable");
  }
}

export interface VerifiedMedicalDocument {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}

// pdfinfo parses the complete document. It must be installed in the isolated worker.
export function verifyMedicalDocument(source: Uint8Array, receivedMime: string): VerifiedMedicalDocument {
  if (receivedMime !== "application/pdf" || source.byteLength < 32
    || source.byteLength > MAX_MEDICAL_DOCUMENT_BYTES
    || !/^%PDF-(?:1\.[0-7]|2\.0)\r?\n/.test(Buffer.from(source.subarray(0, 12)).toString("latin1"))
    || !/%%EOF\s*$/.test(Buffer.from(source.subarray(-1024)).toString("latin1"))) {
    throw new Error("medical_document_invalid_pdf");
  }
  let info: string;
  try {
    info = execFileSync("pdfinfo", ["-"], {
      input: Buffer.from(source), encoding: "utf8", timeout: 20000,
      maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    throw new Error("medical_document_invalid_pdf");
  }
  const pages = /^Pages:\s+(\d+)\s*$/m.exec(info);
  if (!pages || !/^[1-9]\d{0,3}$/.test(pages[1])
    || !/^Encrypted:\s+no\b/im.test(info)
    || !/^JavaScript:\s+no\b/im.test(info)) {
    throw new Error("medical_document_invalid_pdf");
  }
  return { bytes: source, pageCount: Number(pages[1]) };
}
